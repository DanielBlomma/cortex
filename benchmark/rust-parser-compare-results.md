# Rust parser benchmark — regex vs tree-sitter

Generated: 2026-04-17T12:17:24.279Z
Corpus: synthetic — 7 files, 3185 bytes
Runs per parser: 5

## Summary

| Metric | regex | tree-sitter | Δ | Δ% |
|---|---:|---:|---:|---:|
| Chunks extracted | 38 | 38 | +0 | 0.0% |
| Unique call edges | 21 | 24 | +3 | 14.3% |
| Unique imports | 5 | 5 | +0 | 0.0% |
| Median parse time (ms) | 0.17 | 98.99 | +98.82 | 59248.0% |
| p95 parse time (ms) | 1.35 | 115.25 | — | — |

## Chunks by kind

| Kind | regex | tree-sitter | Δ |
|---|---:|---:|---:|
| enum | 1 | 1 | 0 |
| function | 11 | 11 | 0 |
| impl | 5 | 5 | 0 |
| macro | 3 | 3 | 0 |
| method | 9 | 9 | 0 |
| module | 4 | 4 | 0 |
| struct | 3 | 3 | 0 |
| trait | 2 | 2 | 0 |

## Interpretation

- **Chunks Δ** > 0 means tree-sitter found structural units the regex parser missed (typically in generic impls, cfg-gated items, complex macros).
- **Call edges Δ** > 0 means tree-sitter identified additional function calls, feeding the graph-rank component of retrieval.
- **Parse time Δ** > 0 is expected — WASM tree-sitter is slower than native regex — but ingest time is dominated by embedding generation in practice.
- These deltas translate to roughly proportional improvements in top-k retrieval precision on Rust-heavy repos, plus unlocked impact-analysis queries that require call edges.
