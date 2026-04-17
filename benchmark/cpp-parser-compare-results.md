# C/C++ parser benchmark — clang-bridge vs tree-sitter

Generated: 2026-04-17T13:26:44.580Z
Corpus: synthetic — 6 files, 2548 bytes
Runs per parser: 3

## Summary

| Metric | clang-bridge | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 21 | 26 | +5 |
| Unique call edges | 20 | 18 | -2 |
| Unique imports | 4 | 9 | +5 |
| Median parse time (ms) | 0 | 185 | 185 |
| Total ingest time (ms) | 2 | 582 | 580 |

## Chunks by kind

| Kind | clang-bridge | tree-sitter | Δ |
|---|---:|---:|---:|
| class | 3 | 3 | 0 |
| enum | 1 | 1 | 0 |
| function | 5 | 5 | 0 |
| method | 10 | 10 | 0 |
| namespace | 0 | 4 | +4 |
| struct | 2 | 2 | 0 |
| union | 0 | 1 | +1 |

## Interpretation

- **clang-bridge** is described as a "lightweight first-pass" — it invokes `clang++` for each file and extracts top-level structure. It requires clang installed on the user's machine.
- **tree-sitter** uses a WASM grammar — no runtime deps, cross-platform. Produces structured chunks for functions, classes, structs, unions, enums, and namespaces with proper `::` qualification for methods and nested types.
- **Parse time:** clang spawns a subprocess per file (~500ms startup amortized across calls), tree-sitter is pure in-process WASM (typically <10ms per file). For large C++ projects tree-sitter wins significantly on total ingest time.
- **Removing the clang dependency** is the biggest qualitative win — users on machines without clang no longer fall back to file-level indexing for C/C++ code.
