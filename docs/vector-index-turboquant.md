# Vector index: slot array + TurboQuant

This change reworks how Cortex stores and scores embedding vectors during
`context.search`, porting the algorithmic inventions from
[turbovec](https://github.com/RyanCodrai/turbovec) (the math, not the Rust
crate) into the TypeScript MCP server.

## What changed

### Exact slot-array backend (default)

`Map<string, Float32Array>` is replaced by a single contiguous `Float32Array`
slot array plus precomputed inverse norms (`ExactVectorBackend`). Because the
embedder writes vectors with `normalize: true`, cosine collapses to a dot
product over a cache-local buffer. Results are identical to before; the layout
is more compact and the scan is friendlier to V8's auto-vectorizer.

This is the default scoring path and carries no recall change.

### Quantized TurboQuant backend (opt-in)

At the end of `cortex embed`, a quantized index (`.context/embeddings/index.tqz`)
is compiled for corpora above a threshold (default 4096 vectors). It applies, in
order:

1. **Randomized Hadamard rotation** — seeded sign-flip + fast Walsh-Hadamard
   transform. Orthonormal, O(d log d), stored as a single seed rather than a
   d×d matrix. Vectors are zero-padded to the next power of two.
2. **Per-coordinate calibration (TQ+)** — robust 5/95-quantile shift+scale
   mapping each rotated coordinate onto the canonical N(0,1) marginal.
3. **Lloyd-Max scalar quantization** — optimal 4-bit (or 2-bit) buckets for the
   standard normal, computed by numeric Lloyd iteration. Data-oblivious.
4. **Length-renormalized correction** — a per-vector scalar making the
   quantized inner-product estimate self-consistent (exact on self-similarity)
   and unbiased.

Scoring is asymmetric: the query stays full precision and builds a nibble
lookup table; stored vectors are scored directly from their 4-bit codes.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `CORTEX_VECTOR_INDEX` | `auto` | `auto`/`exact` use the exact scan; `turboquant` uses the quantized artifact (falls back to exact if missing/stale). |
| `CORTEX_VECTOR_QUANTIZE_MIN` | `4096` | Minimum corpus size to compile a quantized artifact. |
| `CORTEX_VECTOR_QUANTIZE_BITS` | `4` | Quantization bit depth (`4` or `2`). |

The quantized path never load-bears: a missing, stale, or unreadable artifact
silently falls back to the exact scan. Freshness is tied to the actual
embeddings file — the artifact stores the `entities.jsonl` fingerprint
(mtime:size) it was built from and is rejected when that no longer matches the
live file (so a regenerated or partially-written index is caught even when the
model and entity count are unchanged). Artifacts are structurally validated on
read (header invariants, body length, id count) and any malformed artifact
throws and falls back to exact. The resolved `VectorContext` is memoized and
rebuilt only when the manifest, entities, or artifact file changes.

## Measured results

Representative synthetic corpora (random-Gaussian unit vectors — a worst case
for recall, since real embeddings have cluster structure that lifts it):

| Scale | Memory exact → quant | Recall@10 | Scan latency (exact → quant) |
|---|---|---|---|
| 41k × 384 (django-ish) | 60.1 MB → 10.2 MB (5.9×) | 87.2% | 21.4 ms → 23.5 ms |
| 121k × 768 (teleport+jina) | 354.5 MB → 59.5 MB (6.0×) | 86.7% | 98.0 ms → 111.9 ms |

Two honest takeaways:

- **The win is memory (~6×), not latency.** In pure JS the nibble-LUT scan does
  not beat V8's auto-vectorized Float32 dot product. A real per-query speedup
  needs a WASM SIMD kernel (deferred — see below).
- **Recall must be validated on real embeddings before enabling by default.**
  The numbers above are a synthetic worst case. Run the harness on a real index:

  ```bash
  node tools/vector-bench.mjs .context/embeddings/entities.jsonl --k=10
  # or synthetic: node tools/vector-bench.mjs --synthetic=121000 --dim=768
  ```

Because of these two points, `auto` keeps the exact scan as the default. The
quantized artifact is compiled and ready, but only used when explicitly opted
into via `CORTEX_VECTOR_INDEX=turboquant`.

## Deferred (optional, from the original plan)

- **#5 (full) — WASM SIMD scan kernel.** The path to an actual latency win.
  Gate on measured need after real-data recall is confirmed acceptable.
- **#7 — filtered 32-block short-circuit.** Only pays off on filtered queries
  and needs the vector filter pushed into the scan stage.
