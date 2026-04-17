# Java parser benchmark — file-level baseline vs tree-sitter

Generated: 2026-04-17T13:11:11.474Z
Corpus: synthetic — 6 files, 2465 bytes
Runs: 5

## Summary

| Metric | baseline (file-level) | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 6 | 23 | +17 (3.8×) |
| Unique call edges | 0 | 18 | +18 |
| Unique imports | 0 | 6 | +6 |
| Median parse time (ms) | n/a | 20.69 | — |
| p95 parse time (ms) | n/a | 32.06 | — |

## Chunks by kind

| Kind | baseline | tree-sitter | Δ |
|---|---:|---:|---:|
| class | 0 | 4 | +4 |
| constructor | 0 | 4 | +4 |
| enum | 0 | 1 | +1 |
| file | 6 | 0 | -6 |
| interface | 0 | 1 | +1 |
| method | 0 | 12 | +12 |
| record | 0 | 1 | +1 |

## Interpretation

- **Chunks** go from file-blobs to fine-grained classes, interfaces, enums, records, methods, and constructors — each addressable individually by retrieval.
- **Call edges** 0 → N unlock find_callers and impact_analysis for Java. Method calls include selector chains (System.out.println, obj.method()).
- **Imports** cover single imports, wildcard (`java.util.*`), and static imports (`java.lang.Math.max`).
- Methods and constructors are qualified by enclosing type path: `UserService.handle`, `Endpoint.ErrorResponse.ctor`.
