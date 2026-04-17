# C/C++ parser benchmark — clang-bridge vs tree-sitter

Generated: 2026-04-17T13:29:39.855Z
Corpus: synthetic — 6 files, 2548 bytes
Runs per parser: 5

## Summary

| Metric | clang-bridge | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 21 | 26 | +5 |
| Unique call edges | 20 | 18 | -2 |
| Unique imports | 4 | 9 | +5 |
| Median parse time (ms) | 0 | 178 | 178 |
| Total ingest time (ms) | 1 | 932 | 930 |

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

- **clang-gated parser** is a regex-based parser that is only activated when `clang --version` succeeds on the host — it doesn't invoke clang per file, but it refuses to run without clang installed. That means users without clang fell back to file-level indexing for C/C++ entirely.
- **tree-sitter** uses a WASM grammar (no runtime deps, cross-platform). Produces structured chunks for functions, classes, structs, unions, enums, and namespaces with proper `::` qualification for methods and nested types.
- **Chunk coverage Δ:** tree-sitter adds namespace chunks (which the regex parser never produced) and union chunks. Methods are properly qualified by enclosing namespace path (e.g. `app::UserService::find`), so the graph disambiguates across namespaces.
- **Import Δ:** tree-sitter captures all `#include` forms (system `<...>` and local `"..."`), regex missed some.
- **Call edges −2:** tree-sitter applies a stricter filter for builtins/casts; regex included a few false positives (e.g. capturing identifiers inside `static_cast<...>`). Tree-sitter's edges are more precise.
- **Parse time +180 ms on 6 files (~30ms/file):** WASM parsing is slower than regex scanning. Irrelevant at ingest time where embedding generation dominates (seconds per file). Query-time retrieval is unaffected.
- **Primary qualitative win:** removing the hard clang dependency means any user gets structural C/C++ parsing out of the box.
