# Bash parser benchmark — file-level baseline vs tree-sitter

Generated: 2026-04-17T17:01:54.664Z
Corpus: synthetic — 5 files, 1893 bytes
Runs: 5

## Summary

| Metric | baseline (file-level) | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 5 | 17 | +12 (3.4×) |
| Unique call edges | 0 | 12 | +12 |
| Unique imports | 0 | 2 | +2 |
| Median parse time (ms) | n/a | 48.85 | — |
| p95 parse time (ms) | n/a | 63.77 | — |

## Chunks by kind

| Kind | baseline | tree-sitter | Δ |
|---|---:|---:|---:|
| file | 5 | 0 | -5 |
| function | 0 | 17 | +17 |

## Interpretation

- **Chunks** go from whole-file blobs to individual functions. Each function becomes addressable in retrieval.
- **Call edges** reflect user-defined function-to-function invocations; shell builtins (echo, cd, export) and common system commands (grep, curl, tar) are filtered so the graph shows script-internal wiring.
- **Imports** capture top-level `source` and `.` directives with static paths. Dynamic paths (e.g. `. "$(dirname "$0")/lib.sh"`) and lazy requires inside function bodies are intentionally skipped — they can't be statically resolved.
- **Covered extensions:** `.sh`, `.bash`, `.zsh` — zsh shares enough syntax with bash for the grammar to extract function definitions correctly.
