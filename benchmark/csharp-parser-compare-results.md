# C# parser benchmark — syntax-only per-file vs batch+SemanticModel

Generated: 2026-04-17T12:53:55.130Z
Corpus: synthetic — 5 files, 2500 bytes

## Summary

| Metric | per-file (syntax) | batch (semantic) | Δ |
|---|---:|---:|---:|
| Chunks extracted | 32 | 32 | +0 |
| Unique call edges | 26 | 26 | +0 |
| Fully-qualified calls | 0 | 26 | +26 |
| Bare-name calls | 26 | 0 | -26 |
| Total ingest time (ms) | 3221 | 1057 | -2164 |
| Time per file (ms) | 644 | 211 | — |

FQ-ratio of batch-resolved calls: **100.0%**

## Interpretation

- **Chunks** should be identical — the collector logic is unchanged; the SemanticModel only affects call resolution, not chunk extraction.
- **FQ-calls Δ** is where Roslyn pays off. `u.Save(x)` is just `"Save"` in syntax-only mode; in batch mode it resolves to `"Demo.Domain.UserRepo.Save"`. This disambiguates same-named methods in the call graph.
- **Total ingest time:** per-file pays N dotnet startup costs (~500ms each); batch pays one startup + compilation. For ≥3 files batch is strictly faster; below that the compilation overhead dominates.
- On real repositories with 50-500 C# files, batch mode can cut total ingest time by an order of magnitude while also improving call-graph quality.
