# Bootstrap perf plan — bulk graph load, parallel ingest, typed-array vectors

Status: PLAN (local document, not committed).
Targets: `scaffold/mcp/src/loadGraph.ts`, `scaffold/scripts/ingest.mjs`,
`scaffold/mcp/src/embeddings.ts` (+ search wiring).
Hard constraint for all three: **zero retrieval-quality change** — identical
chunks, identical graph, identical ranking (vector deviation far below the
6-decimal rounding cortex already applies).

These are items 4, 8, and 9 from `docs/cortex-optimization-findings.md`,
sequenced after the PR #91 work (scheduler, pipeline overhead, query LRU).
Implementation order: **A (graph bulk load) → C (typed-array vectors) → B
(parallel ingest)** — A is the biggest absolute win, C is the cheapest, B has
the most moving parts and the least relative impact (~5–15% of bootstrap).

## 0. Facts established by code inspection (2026-06-12)

| Fact | Evidence |
| --- | --- |
| Loader executes one native round-trip per row | `executeBatch` in `loadGraph.ts:11` — `conn.execute(statement, item)` per row, `Promise.all` over slices of `BATCH_SIZE = 50` |
| ryugraph's Node binding DOES expose the COPY path | `strings ryujs.node` shows `COPY_FROM`, `COPY_CSV`, `COPY_JSON`, `COPY_PARQUET` and the statement template `` COPY `{}` FROM "{}" {}; `` — COPY is a Cypher statement issued via `conn.query()`; no dedicated binding API needed. Resolves the caveat from the findings doc. |
| The existing `.context/db/import/*.tsv` files are unusable for COPY | `sanitizeTsvCell` (`ingest.mjs:1045`) flattens tabs and newlines to spaces — lossy for chunk bodies. The loader must emit its own RFC 4180 CSV. |
| Edge inserts currently skip dangling endpoints silently | edges are `MATCH (a {id:$from}), (b {id:$to}) CREATE ...` — a non-matching id is a no-op. COPY into a rel table errors on unknown node keys, so edges must be pre-filtered. |
| The loader already holds every row in memory | all `parse*` results are materialized arrays before any insert — emitting CSV is a contained change. |
| Ingest parse loop is sequential and per-file independent | `ingest.mjs:2783` — `await parser.parse(content, path, language)` per file; all cross-file state (alias indexes, relation maps, windowing) is applied *after* the parse returns, on the main thread. |
| C# is already a special case | project-wide Roslyn batch parse (`parseCSharpProject`, `ingest.mjs:2755`) — stays on the main thread, untouched by the worker pool. |
| Vectors are boxed `number[]` parsed from decimal JSONL | `parseEmbeddingIndex` (`embeddings.ts:67`) builds `Map<string, number[]>`; `~3.5 KB/entity` text re-parsed whenever the mtime/size cache key changes. |
| transformers.js already returns a typed array | `toVector` (`embeddings.ts:40`) does `Array.from(output.data)` — it *boxes* an existing `Float32Array` today. The typed-array change removes work. |
| Scores are rounded to 4 decimals at the API boundary | `embedding_score: Number(vectorSemantic.toFixed(4))` (`searchResults.ts:114`) — float32 perturbation (~1e-8) cannot change any reported score. |

Convention: all changes land in `scaffold/` (the installed source of truth),
one `perf:` commit per item, tests alongside (`scaffold/mcp/tests/` for A and
C, root `tests/` for B), mirroring how the PR #91 commits were structured.

---

## A. Bulk-load the graph via COPY FROM (`loadGraph.ts`)

### Design

1. **Extract a CSV writer module** `scaffold/mcp/src/graphCsv.ts` (keeps
   `loadGraph.ts` under control and makes escaping unit-testable):
   - `toCsvCell(value)`: always quote; double internal `"`; pass newlines/
     commas/CR through verbatim inside quotes; booleans as `true`/`false`,
     numbers via `String()`.
   - `writeCsv(filePath, header, rows)`: header row + quoted cells, `\n`
     line endings, trailing newline.
2. **In `loadGraph.ts`**, after the existing JSONL parse:
   - Build node-id sets (`fileIds`, `ruleIds`, `adrIds`, `chunkIds`,
     `moduleIds`, `projectIds`) from the parsed entities.
   - **Pre-filter every edge list** so both endpoints exist in the right
     set — this reproduces today's MATCH…CREATE skip semantics exactly
     (COPY would otherwise abort on a dangling reference).
   - Write one CSV per table to a scratch dir
     `<CACHE_DIR>/graph-import/` (created fresh, deleted on success):
     nodes with their full column lists, rel tables as
     `from,to[,props…]` in ontology column order.
   - Issue, in the existing insert order (all nodes, then all rels):
     `COPY <Table> FROM "<abs path>" (HEADER=true, DELIM=",", QUOTE='"', ESCAPE='"');`
     via `conn.query()`. Skip tables with zero rows.
3. **Path selection + fallback:**
   - Bulk path runs only on the default reset path (fresh DB after the
     ontology DDL — COPY targets are guaranteed empty). `--no-reset`
     keeps the prepared-statement path unchanged (Kuzu-lineage COPY into
     non-empty tables is not guaranteed).
   - If any COPY statement throws, log a `[graph-load]` warning, wipe and
     re-create the DB, and fall back to the existing `executeBatch` path —
     bootstrap must never get *less* reliable.
   - Env escape hatch `CORTEX_GRAPH_BULK_LOAD=never` forces the old path
     (mirrors the `CORTEX_CSHARP_BATCH` convention).
4. Keep the prepared statements and `executeBatch` in place — they remain
   the `--no-reset`/fallback path; no dead code.

### Risks / edge cases

- **CSV escaping is the whole game.** Chunk bodies contain `"`, `'`, `,`,
  `\n`, `\r\n`, tabs, and unicode; rule/ADR bodies contain markdown. The
  escaping test matrix must cover all of these plus empty strings and the
  `MAX_BODY_CHARS` boundary.
- ryugraph's CSV reader option spelling (`DELIM` vs `DELIMITER`,
  quoting of option values) must be confirmed against the bundled
  `ryu-source` once at implementation time; the option string is one
  constant in `graphCsv.ts`.
- Filtered-out dangling edges were previously *silent*; keep them silent at
  default verbosity but include per-table filtered counts in the
  `graph-manifest.json` summary for observability.

### Acceptance gates

1. Unit: `graphCsv` escaping round-trips a COPY → `MATCH … RETURN` read-back
   for adversarial bodies (quotes/newlines/CRLF/commas/unicode/empty).
2. Equivalence: on a fixture cache (and on this repo's own `.context/cache`),
   run old path and new path into two DBs; `graph-manifest.json` counts must
   be identical, and a full node-by-node property comparison
   (`MATCH (n) RETURN n` sorted by id) must be byte-identical.
3. Perf: bootstrapbench repo with the largest graph — record wall-clock for
   the graph stage before/after; expectation is 10–100x on the load itself.

Effort: ~half a day. Biggest absolute win for 100k-entity repos.

---

## B. Parallelize ingest parsing across worker threads (`ingest.mjs`)

### Design

Parallelize **only the pure parse** (`parser.parse(content, path, language)`),
keep every stateful merge step on the main thread in the existing
deterministic order. Output is then byte-identical by construction: the merge
consumes results indexed by file, iterating `fileRecords` exactly as today
(already sorted by path at `ingest.mjs:2705`), regardless of worker
completion order.

1. **Extract a parser registry** `scaffold/scripts/parsers/registry.mjs`
   from the `loadOptionalParsers` / `getChunkParserForExtension` logic so
   both `ingest.mjs` and the worker can import it. Each entry gains a
   `parallelSafe` flag:
   - `true`: in-process JS/wasm parsers — javascript (acorn), tree-sitter
     wasm languages (python, go, java, ruby, bash, cpp, rust), markdown,
     sql, config, resources, settings.
   - `false`: anything that shells out or holds process-global runtime
     (csharp/Roslyn, vbnet, vb6) — these keep the current sequential/batch
     path on the main thread.
2. **Worker** `scaffold/scripts/ingest-worker.mjs`: loads the registry once
   (wasm init amortized over the worker's lifetime), receives
   `{ taskId, path, content, ext }`, returns
   `{ taskId, parseResult }` or `{ taskId, error }`. Plain JSON payloads —
   `parseResult` is already structured-clone-friendly (`chunks`, `errors`).
3. **Pool in `ingest.mjs`**: split the current loop into
   (a) collect files needing a parse (the existing `shouldParseFile` gate),
   (b) dispatch `parallelSafe` files to the pool, others to the inline
   parser, (c) `await` all results into a `Map<fileId, parseResult>`,
   (d) run the existing per-file merge body unchanged, iterating
   `fileRecords` in order and reading from the map.
   - Pool size: `CORTEX_INGEST_WORKERS`, default
     `max(1, min(os.availableParallelism() - 1, 8))`.
   - Sequential fallback when pool size is 1 **or** parseable-file count
     < ~50 (wasm init in N workers would dominate on small/incremental
     runs — incremental `--changed` updates typically stay sequential).
4. **Failure isolation**: a per-file worker error maps onto the existing
   `try/catch` skip-with-verbose-log behavior. A crashed worker is
   respawned; its in-flight file is retried once on the main thread.
   Workers are explicitly `unref`'d/terminated before the writer phase so
   ingest cannot hang on a wedged thread.

### Risks / edge cases

- `fileRecord.content` is shipped to workers via structured clone — for
  vscode-class repos that is real copy traffic, but parse cost dominates
  per file (tree-sitter ≫ memcpy). If profiling disagrees, fall back to
  having workers read files from disk themselves (path + size + checksum
  guard) — note `content` is already truncated to `MAX_CONTENT_CHARS`, so
  workers re-reading from disk must apply the same truncation.
- Memory: N workers × wasm heaps + in-flight contents. Cap in-flight
  dispatches at ~2× pool size (simple credit counter) so peak memory stays
  bounded.
- Determinism trap: nothing in the worker may allocate ids or timestamps —
  `chunkIdFor`, windowing, checksums all stay on the main thread (they
  already do).

### Acceptance gates

1. Equivalence: full ingest on 2–3 fixture repos (mixed languages incl.
   tree-sitter + acorn + sql/config) with workers=0 vs workers=N —
   **byte-identical** `entities.*.jsonl` and `relations.*.jsonl`; repeat
   N-run for flake detection.
2. Existing parser test suites (root `tests/*-parser.test.mjs`,
   `tests/ingest-units.test.mjs`) pass against the extracted registry.
3. Perf: ingest stage wall-clock on a bootstrapbench large repo;
   expectation near-linear in cores for the parse fraction.

Effort: ~1 day (registry extraction is most of it). Second-order next to A —
ingest is ~5–15% of bootstrap.

---

## C. Typed-array vector index in the MCP server (`embeddings.ts` + search)

### Design

Convert **in memory only**; the JSONL stays canonical (decimal text,
6-decimal rounding) so on-disk artifacts, incremental embedding reuse, and
benchmark comparisons are untouched. The ~1e-8 float32 perturbation is two
orders below the existing rounding and invisible after the 4-decimal score
rounding at the API boundary.

1. `types.ts`: `EmbeddingIndex.vectors: Map<string, Float32Array>`.
2. `embeddings.ts`:
   - `parseEmbeddingIndex`: validate each line's vector as today, then
     store `Float32Array.from(vector)`; the boxed per-line array becomes
     garbage immediately (peak transient memory is one line, not the
     index).
   - `toVector` → return `Float32Array` directly from `output.data`
     (removes today's `Array.from` boxing); keep the finiteness filter.
   - `embedQuery` returns `Float32Array | null`; the LRU becomes
     `LruCache<string, Float32Array>` (entries stay treated as immutable).
3. `searchCore.ts`: `cosineSimilarity(a: Float32Array, b: Float32Array)` —
   loop body unchanged; monomorphic typed-array access is what unlocks
   SIMD-friendly codegen.
4. `searchResults.ts` / `search.ts`: type updates only
   (`embeddingVectors: Map<string, Float32Array>`, `queryVector`,
   `vectorScorer` signature). `runContextSearch` wiring is unchanged.

No other consumers: `grep` confirms vectors flow only through
`search.ts → searchResults.ts` with `cosineSimilarity`; impact/related
tooling does not touch the embedding index.

Out of scope (deliberately): a binary sidecar cache to skip JSONL re-parsing
entirely. Worth revisiting only if first-query latency after refresh still
matters once this lands; it adds an invalidation surface for a one-off cost.

### Acceptance gates

1. Unit: cosine over float32 vs float64 on real fixture vectors —
   `|Δ| < 1e-6` per pair; identical values after `toFixed(4)`.
2. Behavior: `search-graph-score.test.mjs` (and an added ranking fixture
   with embeddings) produce identical result ordering and identical
   reported `embedding_score`s before/after.
3. Memory: index-load RSS delta on a large `entities.jsonl`
   (`process.memoryUsage()` before/after `loadEmbeddingIndex`) showing the
   ~4x vector-storage reduction.

Effort: 2–3 hours. Cheapest of the three; do it right after A.

---

## Rollout

1. Branch stays `feature/bootstrap-bench-site`; one commit per item
   (`perf: bulk-load graph via COPY FROM`, `perf: float32 vector index`,
   `perf: parallel ingest worker pool`), each with its tests.
2. After each item: `npm test` (root) + `npm --prefix scaffold/mcp test`,
   then a full `cortex bootstrap` self-run on this repo as a smoke test.
3. Final verification: bootstrapbench timing run on the largest pinned
   repos; record stage-level before/after in
   `docs/cortex-optimization-findings.md` (items 4, 8, 9 → "measured").
