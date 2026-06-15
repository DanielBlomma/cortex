# Cortex performance findings — zero-quality-loss optimizations

Findings from instrumenting `cortex bootstrap` across large real-world repos
(benchmark/bootstrapbench) on 2026-06-11. Scope: optimizations that change
**nothing** about retrieval quality — identical chunks, identical vectors (up
to float noise far below ranking significance), identical graph.

## Measured this session

### 1. ryugraph's broken arm64 packaging forces a ~10x Rosetta tax (fixed in eval; report upstream)

`ryugraph@25.9.0/25.9.1` ship `prebuilt/ryujs-linux-arm64.node` whose ELF is
actually **x86_64** (`e_machine 0x3E`), and the genuine x86_64 binary requires
glibc ≥ 2.38. Consequences: cortex bootstrap is broken on native linux-arm64
and on Debian bookworm; our containers initially ran amd64-under-Rosetta.
Measured embedding throughput: **~165 entities/s native** (Apple Silicon host)
vs **~12/s** in an emulated container. The eval image now compiles ryugraph
from its bundled source on arm64 (isolated `npm_config_build_from_source`
install). **Action for cortex/ryugraph: fix the published arm64 prebuilt.**

### 2. Embedding batching does NOT help on the current runtime (negative result, verified)

Hypothesis was that batching texts per forward pass would speed up CPU
inference. Measurements on `onnxruntime-node` (transformers.js v4, MiniLM):

| Strategy | Throughput vs single-text |
| --- | --- |
| single text per call | 1.00x (157–165/s native) |
| naive batch 8–64 | 0.22–0.28x |
| length-sorted batch 8–32 | 0.54–0.72x |
| uniform-length batch 16 | 0.86x |

A follow-up controlled experiment refined the mechanism: the loss persists
with ONNX capped to a single thread (0.31x), so it is **not** thread-pool
saturation — padding waste dominates (every batch member pads to the batch
max; attention is O(L²) in padded length) plus memory pressure from the
larger activation tensors. Crucially, batching **wins 2.1x on short uniform
texts** (60 chars), so the result is workload-dependent: cortex's entity mix
(long, heterogeneous file/chunk texts) is exactly the regime where batching
loses. A token-length-bucketed strategy — batch only similar-length short
entities, keep long ones single — is the credible way to capture the
short-text win on real corpora.

Equivalence was verified (max cosine deviation single↔batched ≈ 5e-7 on real
chunks): the machinery is correct, so `embed.ts` now supports
`CORTEX_EMBED_BATCH_SIZE` as an **opt-in** knob, with batch-level failures
isolated by per-item retry. **Default remains 1 — identical behavior to
before, and the measured optimum for cortex's corpus.**

### 3. Co-located embedders oversubscribe cores (fixed)

With N parallel bootstrap containers, each onnxruntime spawns
threads-as-if-alone; 3 containers × 12-thread pools on 12 cores measurably
degraded aggregate throughput (3 × 3.5/s < 1 × 12/s under emulation).
`embed.ts` now honors `CORTEX_EMBED_THREADS` (intra-op thread cap), and the
eval runner sets it alongside a docker `--cpus` quota (`docker.cpus: "auto"`).

## Verified opportunities in cortex itself (not yet implemented)

Ordered by expected impact.

### 4. Bulk-load the graph instead of row-by-row inserts — IMPLEMENTED

Status: shipped on `perf/bootstrap-stage-optimizations`. Measured on this
repo's cache (59 files, 410 chunks, ~970 edges): graph load **9.5s → 0.6s
(~15x)**, byte-identical graph (equivalence test compares every node and edge,
old path vs COPY path). The two confirmed escaping requirements — `PARALLEL=false`
(quoted newlines) and `NULL_STRINGS=[<NUL>]` (empty-string preservation) — are
documented in `graphCsv.ts`. The row-by-row loader is retained for `--no-reset`
and as the on-error fallback.

Original finding below.

`loadGraph.ts` inserts every node/edge via prepared statements in batches of
50 (`executeBatch`, `conn.execute` per row). Kuzu-lineage engines provide
`COPY ... FROM` bulk ingestion that is typically 10–100x faster for initial
loads. The loader already materializes all rows in memory, so emitting CSV
(or feeding arrays if the binding supports it) is a contained change with
byte-identical resulting graphs. Biggest absolute win on 100k-entity repos,
where graph load takes minutes. *Caveat: verify ryugraph exposes Kuzu's COPY
path in its Node binding.*

### 5. Stop rebuilding TypeScript on every pipeline run

`cortex bootstrap` / `cortex update` run `npm run embed` and
`npm run graph:load`, and **each** chains `npm run build --silent` — two full
`tsc` compiles per run, every run, even with sources unchanged (tsconfig has
no `incremental`). Fix: `tsc --incremental` plus a sources-unchanged guard
(hash/mtime marker) to skip entirely. Saves ~10–30s × 2 on every bootstrap
and every incremental update, on every machine, forever.

### 6. Skip the npm install when node_modules already satisfies the lockfile

Bootstrap step 1 runs `npm install` for `.context/mcp` and the parsers on
every invocation (~10–60s warm, minutes cold). A marker file recording the
lockfile hash would make repeat bootstraps and updates skip both installs.
Related: the status step performs a live npm registry lookup for
`cortex_latest_version` inside the bootstrap path — cache it (daily TTL) so
bootstrap has zero gratuitous network calls.

### 7. Deduplicate identical embedding texts within a run

Vendored/duplicated code produces chunks with identical normalized text;
each is embedded separately today. A content-hash memo (`hash(text) →
vector`) reuses the computation — identical text yields an identical vector
by definition, so this is provably lossless. Cheap to implement in
`embed.ts`; pays on monorepos and vendored trees.

### 8. Parallelize ingest across worker threads — IMPLEMENTED

Status: shipped on `perf/bootstrap-stage-optimizations`. The parser registry
was extracted to `ingest-parsers.mjs` (single source of truth) and a
`worker_threads` pool (`ingest-worker.mjs`) runs the pure parse step.
Measured on a 400-file Python corpus: ingest **2.5s → 0.8s (~3x)**.
Byte-identical output verified by a workers=0 vs workers=4 equivalence test.
Only the parse moves to workers; all stateful merge work stays on the main
thread in deterministic order. csharp/vbnet/cpp stay inline; runs below 50
parse tasks stay sequential.

Original finding below.

`ingest.mjs` parses files sequentially on one core; tree-sitter parsing is
CPU-bound and embarrassingly parallel across files. A `worker_threads` pool
(workers own their parser instances) makes the ingest phase near-linear in
cores with byte-identical output. Ingest is minutes on vscode-scale repos,
seconds on medium ones — worthwhile but second-order next to #4/#5.

### 9. Typed-array vector index for search latency — IMPLEMENTED

Status: shipped on `perf/bootstrap-stage-optimizations`. The in-memory index
now stores `Float32Array` (JSONL stays canonical 6-decimal text). Cosine over
float32 matches the float64 reference within 1e-6 and is identical after the
4-decimal `embedding_score` rounding, so no ranking or reported score changes;
live search on the real index is unchanged.

Original finding below.

`loadEmbeddingIndex` keeps each vector as a JS `number[]` (float64 + array
overhead) and the JSONL stores vectors as decimal text (~3.5 KB per entity —
tens of MB for large repos, parsed on first search after every index
refresh). Storing/loading vectors as `Float32Array` (binary sidecar or
base64) cuts memory roughly 4x and makes the cosine loop SIMD-friendly.
Nuance: re-encoding the 6-decimal-rounded values as float32 perturbs them by
~1e-8 — an order of magnitude below the rounding cortex already applies; if
bit-exactness is required, keep JSONL canonical and convert only in memory.

### 10. Tiny LRU for query embeddings

`embedQuery` re-embeds the query string on every `context.search`/`impact`
call (the model is cached; the inference is not). Agents repeat queries
verbatim across a session; a ~256-entry LRU keyed `(model, query)` is a free
5–20 ms saved per repeated call, with zero semantic change.

## Already good (checked, no action)

- The embedding **model pipeline** is cached per process with retry cooldown.
- The **embedding index** reload is mtime/manifest-keyed — no reparse per query.
- Incremental ingest (`--changed`) and signature-based **embedding reuse**
  already avoid recomputation across runs.
- Mean-pooling is attention-mask-aware (verified by the batching equivalence
  test), so there is no hidden padding bug in current single-text inference.
