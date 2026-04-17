# VB6 parser benchmark — file-level baseline vs regex parser

Generated: 2026-04-17T17:11:55.087Z
Corpus: synthetic — 5 files, 3257 bytes
Runs: 5

## Summary

| Metric | baseline (file-level) | vb6 regex | Δ |
|---|---:|---:|---:|
| Chunks extracted | 5 | 27 | +22 (5.4×) |
| Unique call edges | 0 | 38 | +38 |
| Median parse time (ms) | n/a | 0.27 | — |
| p95 parse time (ms) | n/a | 1.24 | — |

## Chunks by kind

| Kind | baseline | vb6 regex | Δ |
|---|---:|---:|---:|
| class | 0 | 2 | +2 |
| enum | 0 | 1 | +1 |
| file | 5 | 0 | -5 |
| form | 0 | 1 | +1 |
| function | 0 | 4 | +4 |
| method | 0 | 13 | +13 |
| module | 0 | 2 | +2 |
| property | 0 | 2 | +2 |
| type | 0 | 2 | +2 |

## Interpretation

- **VB6 has no tree-sitter grammar** — this parser is regex-based, following the same pattern as the legacy pre-tree-sitter Rust and C/C++ parsers.
- **Chunk granularity** goes from file-blobs to individual Sub/Function/Property/Type/Enum chunks. Class members are qualified as `ClassName.Method`; .bas module members as `ModuleName.Func`.
- **Property Get/Let/Set** for the same property are collapsed to a single `property` chunk, avoiding three near-duplicate entries in the graph.
- **Call extraction** covers four VB6 patterns: `Func(args)`, `Call Func(args)`, `obj.Method`, and bareword `SubName` (a call with no parens, common in VB6). Builtins like `MsgBox`, `Len`, `CStr`, `Debug.Print` are filtered.
- **`.frm` designer blocks** are stripped before parsing so the parser only sees code (not the `BEGIN...END` property trees).
- **No imports:** VB6 has no import mechanism in source — references live in the `.vbp` project file. chunk.imports is always empty.
