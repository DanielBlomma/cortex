# C# Roslyn semantic upgrade

**Status:** Shipped.
**Date:** 2026-04-17

## Context

The C# parser (`scripts/parsers/dotnet/CSharpParser`) was built as a Roslyn-based sidecar invoked once per file via `dotnet run --stdin --file X.cs`. Two structural limitations:

1. **Syntax-only extraction.** The parser used `CSharpSyntaxTree.ParseText` and collected `InvocationExpressionSyntax` descendants, but produced *bare identifier names* for calls (`"Save"`, `"ReadAllText"`). Two different types exposing `Save(string)` produced the same edge in the call graph, making "find callers of UserRepo.Save" indistinguishable from "find callers of OrderRepo.Save".

2. **Per-file dotnet startup.** Each `.cs` file = one `dotnet run` invocation with ~500ms JIT startup. On a 500-file project: ~4 minutes just for process startup before any parsing work happens.

Both limitations became visible when the tree-sitter rollout exposed how much richer structural parsing *could* be, and when the upcoming benchmark required honest C# call-graph quality.

## Decision

Add a project-wide **batch mode** to the Roslyn sidecar that compiles all `.cs` files in a single `CSharpCompilation` and uses `SemanticModel.GetSymbolInfo` to resolve invocations to fully-qualified method symbols. Keep the legacy per-file mode for backwards compatibility and for scenarios where the full project isn't available.

### Protocol v2 in `Program.cs`

Two modes selected by CLI flag:

- **Legacy (`--stdin --file X.cs`)** — unchanged from prior behavior. Syntax-only. Used as fallback.
- **Batch (`--batch`)** — reads JSON from stdin:
  ```json
  { "files": [{ "path": "A.cs", "source": "..." }, ...] }
  ```
  and writes JSON to stdout:
  ```json
  { "files": { "A.cs": { "chunks": [...], "errors": [...] }, ... } }
  ```

### Reference assemblies

Added NuGet package `Basic.Reference.Assemblies.Net100` (1.8.5) — an official Microsoft package that embeds the full .NET 10 reference assemblies as resources. This is the standard way to provide BCL metadata references to Roslyn in tooling scenarios without depending on a specific SDK installation. Cross-platform, no filesystem discovery needed.

### Semantic resolution

```csharp
var info = semanticModel.GetSymbolInfo(invocation);
var method = info.Symbol as IMethodSymbol
    ?? info.CandidateSymbols.OfType<IMethodSymbol>().FirstOrDefault();
if (method != null) {
    var container = method.ContainingType.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);
    if (container.StartsWith("global::")) container = container.Substring("global::".Length);
    return $"{container}.{method.Name}";
}
// fallback to syntax name
return GetInvocationSyntaxName(invocation.Expression);
```

Unresolved calls (e.g. via `dynamic`, or when referenced type isn't in the compilation) fall back to the syntax-based bare name, so output degrades gracefully rather than losing edges entirely.

### Bridge (`csharp.mjs`)

- `parseCode(code, filePath, language)` — per-file, syntax-only. Invokes the pre-published `CSharpParser.dll` via `dotnet <dll> --stdin --file X.cs`.
- `parseProject(files: [{path, content}])` — batch. Invokes `dotnet <dll> --batch`, streams JSON in/out, returns `Map<path, {chunks, errors}>`.
- `ensureCSharpParserPublished()` — on first use, runs `dotnet publish -c Release` once to `bin/Release/<tfm>/publish/` and caches the DLL path. Subsequent calls skip the msbuild cycle (~10× speedup per single-file call).

### Ingest integration

In both `scripts/ingest.mjs` and `scaffold/scripts/ingest.mjs`:

1. Before the main file-parsing loop, collect all `.cs` files from `fileRecords`.
2. If the C# runtime is available and at least one `.cs` file needs parsing (respecting incremental mode), call `parseCSharpProject(allCsharpInputs)` once with **all** project `.cs` files (changed + unchanged — needed for cross-file resolution). Cache results per file path.
3. In the main loop, when a `.cs` file is processed, pull the cached batch result instead of invoking `parser.parse()`.
4. If batch fails or returns nothing, the per-file parser.parse() fallback runs transparently.

Opt-out: `CORTEX_CSHARP_BATCH=never` forces per-file mode.

## Consequences

### Positive

- **100% fully-qualified calls** in batch mode (measured on synthetic corpus) — `u.Save(x)` → `"Demo.Domain.UserRepo.Save"`. Disambiguates same-named methods in the call graph, which is the primary quality metric for "find callers" and impact-analysis queries.
- **3× faster ingest** on the 5-file synthetic corpus (3221 ms → 1057 ms). Scales better: 500-file repo estimated at ~4 min per-file → ~30 s batch, since the dotnet startup is amortized once and compilation is the cheaper per-file work.
- **Resolved BCL calls** (`System.IO.File.ReadAllText` etc.) — was previously bare `"ReadAllText"`. Users searching for callers of `File.ReadAllText` now get exact matches instead of collisions with any method named `ReadAllText`.
- **No regression** — `parseCode` kept as-is, all 13 pre-existing tests still pass. 7 new tests cover batch-specific behavior.

### Trade-offs

- **Compilation memory** — Roslyn's full compilation can use 200-400 MB for mid-sized projects. Acceptable at ingest time (one-shot), documented for users with very large (>500k LOC) projects.
- **Incremental accuracy** — batch-parses *all* `.cs` files on every ingest (even unchanged ones), so we can resolve calls against unchanged types. This costs a full compilation each time, but amortizes fine given the speed gain.
- **Can't resolve dynamic calls** — `dynamic x; x.Unknown();` has no symbol. Falls back to bare name, same as syntax-only mode. This is a Roslyn limitation, not ours.
- **External non-BCL assemblies** — third-party NuGet types (e.g. Newtonsoft.Json) aren't in the compilation's references, so calls to them resolve only if a corresponding type is defined locally. Bare-name fallback kicks in. Acceptable: project-internal call graph is what matters most for ingestion-time analysis.

## Benchmark results

`benchmark/csharp-parser-compare.mjs` on a 5-file synthetic corpus (Cache, Repository, UserService, OrderService, Endpoint — cross-file calls, BCL calls, records, interfaces):

| Metric | per-file (syntax) | batch (semantic) | Δ |
|---|---:|---:|---:|
| Chunks extracted | 32 | 32 | parity (collector unchanged) |
| Unique call edges | 26 | 26 | parity |
| Fully-qualified calls | 0 | 26 | **+26 (100%)** |
| Bare-name calls | 26 | 0 | **-26** |
| Total ingest time | 3221 ms | 1057 ms | **-67%** |
| Time per file | 644 ms | 211 ms | 3× faster |

## Rollout

1. ✅ Protocol v2 in `Program.cs`, references via `Basic.Reference.Assemblies.Net100`, SemanticModel-based call resolution with syntax fallback.
2. ✅ `parseProject` export in `csharp.mjs`; `isCSharpParserAvailable` unchanged.
3. ✅ Ingest integration with batch-first, per-file fallback, `CORTEX_CSHARP_BATCH=never` opt-out.
4. ✅ Scaffold mirrored.
5. ✅ Tests: 20 total (13 pre-existing + 7 new). Full suite 179 green.
6. ✅ Benchmark harness for continuous verification.

## Future

- Similar semantic upgrade for VB.NET (identical Roslyn architecture, different grammar) — straightforward port of this work.
- Consider surfacing method arity/parameter types in the fq-name (`"Demo.UserRepo.Save(string)"` vs `"Demo.UserRepo.Save(int)"`) for overload disambiguation. Currently overloads collapse to same edge.
- Explore incremental compilation caching between ingest runs if re-compilation time becomes a bottleneck.
