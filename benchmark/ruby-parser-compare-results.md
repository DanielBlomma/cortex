# Ruby parser benchmark — file-level baseline vs tree-sitter

Generated: 2026-04-17T13:16:47.825Z
Corpus: synthetic — 6 files, 2258 bytes
Runs: 5

## Summary

| Metric | baseline (file-level) | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 6 | 33 | +27 (5.5×) |
| Unique call edges | 0 | 28 | +28 |
| Unique imports | 0 | 7 | +7 |
| Median parse time (ms) | n/a | 203.59 | — |
| p95 parse time (ms) | n/a | 221.49 | — |

## Chunks by kind

| Kind | baseline | tree-sitter | Δ |
|---|---:|---:|---:|
| class | 0 | 6 | +6 |
| class_method | 0 | 7 | +7 |
| file | 6 | 0 | -6 |
| method | 0 | 14 | +14 |
| module | 0 | 6 | +6 |

## Interpretation

- **Chunks** granularize files into classes, modules, instance methods, and class methods — each addressable individually.
- **`Class#method` vs `Class.method`** naming distinguishes instance from class-method calls in the graph (Ruby doc convention). This matters for find-callers accuracy when both forms share a bare name.
- **Imports** extract require / require_relative / autoload paths from top-level calls; lazy requires inside methods are ignored so the file's declared dependencies aren't polluted.
- **Call filter** excludes stdlib/DSL noise (puts, p, attr_*, private, raise, etc.) to keep the graph focused on real function-to-function edges.
