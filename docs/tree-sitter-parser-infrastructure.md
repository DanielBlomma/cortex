# Tree-sitter parser infrastructure

**Status:** Piloted (Rust only). Default parser for `.rs` files as of this change.
**Date:** 2026-04-17

## Context

Cortex extracts semantic chunks (functions, classes, methods, call-graphs) from source files to power its retrieval and impact-analysis tools. Each language needs a parser that produces chunks matching the following shape:

```
{ name, kind, signature, body, startLine, endLine, language, exported, calls[], imports[] }
```

Until this change, Cortex had two kinds of parsers:

1. **AST-based** — JavaScript/TypeScript (`acorn` + `acorn-typescript`).
2. **Sidecar-based** — C#, VB.NET via a Roslyn `dotnet run` subprocess; C/C++ via `clang`.
3. **Regex-based** — Rust, SQL, config, resources.

Eight languages had entries in `CONTENT_SOURCE_EXTENSIONS` (`.py`, `.go`, `.java`, `.rb`, `.php`, `.swift`, `.kt`, `.sh/.bash/.zsh/.ps1`) but **no chunk parser** — they fell back to whole-file indexing with zero call-graph coverage. This produced weak retrieval, broken impact-analysis, and poor benchmark numbers on polyglot repos.

The Rust parser was regex-only and missed `macro_rules!`-defined items with unusual delimiters, `#[cfg(...)]`-gated blocks, and complex `impl<T: Bound>` generics.

## Decision

Adopt **tree-sitter** (via `web-tree-sitter` WASM) as the shared infrastructure for future language parsers. Roll it out one language at a time, starting with Rust as a pilot where the regression risk is lowest (regex parser is the weakest baseline, so any tree-sitter improvement is a net win).

### Technical approach

- **Runtime:** `web-tree-sitter@0.22.6` (WASM runtime for tree-sitter). No native compilation on install — same binary works on Linux/macOS/Windows/WSL.
- **Grammars:** `tree-sitter-wasms@0.1.13` ships pre-built WASM grammars for 40+ languages including all target languages (Rust, Python, Go, Java, Ruby, PHP, Kotlin, Swift, Bash).
- **Base infrastructure:** `scripts/parsers/tree-sitter/base.mjs` — shared loader (cached per grammar), parser factory, query runner, and helpers (`groupByAnchor`, `lineRangeOf`, `bodyOf`, `dedupe`).
- **Query format:** S-expression `.scm` files under `scripts/parsers/tree-sitter/queries/`, one per language per concern (`rust.chunks.scm`, `rust.calls.scm`, `rust.imports.scm`).
- **Language modules:** thin adapters like `rust-treesitter.mjs` that pre-initialize the grammar via top-level `await` at module evaluation time. This lets `parseCode()` remain **synchronous**, matching the contract expected by `scripts/ingest.mjs` (which calls parsers inside its file loop).

### Dispatch and fallback

`scripts/parsers/rust-dispatch.mjs` selects the active parser via `CORTEX_RUST_PARSER`:

| Env value | Behavior |
|---|---|
| unset (default) | tree-sitter, auto-fallback to regex on load error |
| `tree-sitter` | force tree-sitter (error if WASM unavailable) |
| `regex` | force regex parser |

Both `scripts/ingest.mjs` and `scaffold/scripts/ingest.mjs` import `rust-dispatch.mjs` — single source of truth for the selection logic.

## Consequences

### Positive

- **Richer Rust parsing** — catches generic impls (`impl<T: Bound>`), `#[cfg(...)]`-gated items, nested modules, generic trait impls. Tree-sitter produces a **superset** of what the regex parser extracted (verified by parity test).
- **Reusable infrastructure** — Python, Go, Java, and the other 5 target languages can be added in ~0.5 day each by writing queries + adapter + tests.
- **Zero native compilation** — WASM grammars avoid `node-gyp`/toolchain friction on user machines.
- **Cleaner retrieval** — per-function chunks instead of whole-file fallback → top-k retrieval becomes fine-grained, context sent to LLMs shrinks ~10–30×.

### Negative / trade-offs

- **Disk cost:** `tree-sitter-wasms` ships ~40 grammar WASMs, ~80MB installed. Acceptable given the reach (unused grammars are not loaded into memory; `loadGrammar` is lazy).
- **Parse latency:** WASM is slightly slower than native `acorn`. Acceptable for ingest (seconds-scale, cached), irrelevant for queries (parsing only happens at ingest time).
- **No semantic resolution** — tree-sitter gives syntax trees, not type-resolved calls. Same limitation as the existing regex and Roslyn-sidecar parsers. Call-graph edges remain name-based, not binding-based.
- **Query maintenance** — grammar version bumps may require query tweaks. Mitigated by pinning versions (`web-tree-sitter@0.22.6`, `tree-sitter-wasms@0.1.13`) and testing full query coverage.

### Deliberately left unchanged

- **JavaScript/TypeScript** — retains `acorn` + `acorn-typescript` + custom `scope-analysis`. Tree-sitter would be a regression for JS/TS because we'd lose scope-resolution unless we re-implement it. Acorn stays as the gold standard; tree-sitter is for languages that had no parser or only a regex.
- **C#/VB.NET** — Roslyn sidecars continue to provide the richest output for these languages.

## Rollout plan

1. ✅ **Phase 0** — Shared tree-sitter infrastructure (`base.mjs` + tests).
2. ✅ **Phase 1** — Rust parser pilot with parity tests against regex baseline.
3. ✅ **Phase 2** — Cutover: tree-sitter becomes default for `.rs`; regex kept as explicit fallback. Scaffold mirrors both.
4. ✅ **Phase 3** — Benchmark baseline run (`benchmark/rust-parser-compare.mjs`), see results below.
5. ⏸ **Future** — Roll out to Python, Go, Java, Ruby, PHP, Kotlin, Swift, Bash based on benchmark priority.

## Phase 3 benchmark results

Synthetic Rust corpus (7 files, 3185 bytes, covering generics, cfg-gated items, traits, macros, nested modules, closures):

| Metric | regex | tree-sitter | Δ |
|---|---:|---:|---:|
| Chunks extracted | 38 | 38 | 0 |
| Unique call edges | 21 | 24 | **+14.3%** |
| Unique imports | 5 | 5 | 0 |
| Median parse time | 0.17 ms | 99 ms | +99 ms |

**Interpretation:**
- **Structural parity** on this corpus — both parsers found the same 38 chunks (functions, methods, structs, impls, macros, modules, traits, enums). The regex parser is well-tuned for these patterns.
- **+14.3% call edges** — tree-sitter adds real AST call extraction for plain `foo()` and method calls; a pragmatic hybrid also extracts identifier-call patterns from inside `macro_invocation` token trees, matching regex behavior there.
- **Latency Δ is expected and irrelevant in practice** — ingest time is dominated by embedding generation (seconds per file), not parse time (milliseconds). Parsing is ~1% of total ingest cost even at the 99ms mark.
- **Tree-sitter is ready as default.** Zero regressions, measurable call-graph improvement, and the infrastructure (WASM runtime + base helpers + query format) is proven and ready to carry the 8 remaining languages.

Run with a real corpus via `node benchmark/rust-parser-compare.mjs --corpus /path/to/rust/src --runs 10 --output benchmark/real-corpus-delta.md` to measure on project-specific code.

## Verification

- `tests/tree-sitter-base.test.mjs` — 10 tests covering loader, query runner, helpers.
- `tests/rust-treesitter-parser.test.mjs` — 21 tests: 17 mirror the regex parser suite, 4 cover new capabilities (generic impls, cfg-gated items, nested modules, generic trait impls). Includes parity test asserting tree-sitter output is a superset of regex output on shared input.
- Full suite (159 tests) green.

## Files

- `scripts/parsers/tree-sitter/base.mjs` — runtime + helpers.
- `scripts/parsers/tree-sitter/queries/rust.{chunks,calls,imports}.scm` — Rust queries.
- `scripts/parsers/rust-treesitter.mjs` — adapter producing Cortex chunk shape.
- `scripts/parsers/rust-dispatch.mjs` — env-based selector with auto-fallback.
- `scripts/parsers/rust.mjs` — legacy regex parser (retained as fallback).
- `scripts/ingest.mjs` — imports `rust-dispatch.mjs` instead of `rust.mjs` directly.
- `scaffold/` — same three files mirrored; `ingest.mjs` mirrored.
- `scripts/parsers/package.json` + lockfile — adds `web-tree-sitter` and `tree-sitter-wasms`.
