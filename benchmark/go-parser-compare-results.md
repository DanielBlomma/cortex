# Go parser benchmark — file-level baseline vs tree-sitter

Generated: 2026-04-17T13:02:58.699Z
Corpus: synthetic — 6 files, 3061 bytes
Runs: 5

## Summary

| Metric | baseline (file-level) | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 6 | 24 | +18 (4.0×) |
| Unique call edges | 0 | 29 | +29 |
| Unique imports | 0 | 10 | +10 |
| Median parse time (ms) | n/a | 11.83 | — |
| p95 parse time (ms) | n/a | 24.65 | — |

## Chunks by kind

| Kind | baseline | tree-sitter | Δ |
|---|---:|---:|---:|
| file | 6 | 0 | -6 |
| function | 0 | 11 | +11 |
| interface | 0 | 1 | +1 |
| method | 0 | 4 | +4 |
| struct | 0 | 6 | +6 |
| type | 0 | 2 | +2 |

## Interpretation

- **Chunk ratio** shows the granularity jump: each Go file was one blob; now it's functions, methods (qualified by receiver type), structs, interfaces, and type aliases.
- **Call edges** 0 → N unlocks find_callers and impact_analysis for Go, previously broken.
- **Imports** go from 0 to structured edges — including grouped import blocks and path aliases, unquoted for clean graph edges.
- Methods are unified by receiver type regardless of pointer-vs-value: `func (s S) F()` and `func (s *S) F()` both become `S.F`, so the call graph doesn't double-count.
