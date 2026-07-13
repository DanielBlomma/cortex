# Angular Bootstrapbench Analysis

## Objective

Explain why Cortex 2.0.19 performed poorly on `angular/angular` in the
published bootstrapbench data and split the findings into implementation-ready
work orders.

## Background

- Benchmark source: `site-data/bootstrap/2.0.19/repos/angular__angular.json`.
- Run: `full-2019`, generated `2026-06-12T05:34:50.388Z`, repo commit
  `71bb19d772aa77a30922fb896f775b58a0862c36`.
- Angular had the largest indexed input in the published 32-repo set:
  `8,248` indexed files and `1,452,594` indexed lines.
- Despite that, it produced only `6,633` chunks, or `4.57 chunks/KLOC`.
  Against the other 31 repos, the median was about `34.6 chunks/KLOC`.
- Graph quality was weak: `357` `CALLS` edges, `0.11` average chunk degree,
  and `93.35%` isolated chunks.
- Unsupported files were high: `2,287` skipped as unsupported in the benchmark.
  Extension inspection of the pinned commit showed major unsupported groups:
  `.bazel` 698, `.html` 457, `.css` 325, `.mts` 174, `.scss` 144, `.svg` 88,
  `.bzl` 40.
- `cortex init` source-path detection included broad top-level directories such
  as `adev`, `devtools`, `goldens`, `integration`, `third_party`, and `tools`,
  so the run embedded a very large mixed monorepo surface.

## Work Profile

New contract/design - fixes touch parser output contracts, ingest relation
semantics, benchmark metrics, and source-path selection behavior.

## Owned Scope

- `scaffold/scripts/ingest.mjs`
- `scaffold/scripts/ingest-parsers.mjs`
- `scaffold/scripts/parsers/javascript.mjs`
- `scaffold/scripts/parsers/javascript/`
- `bin/cortex.mjs`
- `benchmark/bootstrapbench/`
- `site-data/bootstrap/`
- parser and benchmark tests under `tests/`

## Out Of Scope

- MCP search ranking changes unless a later packet shows ranking is the root
  cause after parser/ingest fixes.
- Frontend visualization changes, except adding fields needed to explain
  benchmark coverage.
- Release metadata and npm publishing.

## Constraints

- Preserve Cortex's local-only model; no source upload or external analysis
  service.
- Keep benchmark JSON backward compatible or version the schema.
- Do not make source-path detection silently exclude user code without a clear
  config override or visible diagnostics.
- Parser changes need focused negative tests for syntax that previously failed
  or produced no chunks.

## Known Failure Modes Checklist

- `.tsx` and `.jsx` are counted as code/text in ingest but are not registered in
  `CHUNK_PARSERS`; they become file-level entities without structured chunks.
- `.mts` is unsupported even though Angular contains many modern TypeScript
  module files.
- Angular templates and styles (`.html`, `.css`, `.scss`) are unsupported, so
  `templateUrl`, `styleUrl(s)`, selectors, and bindings are invisible.
- TypeScript interfaces, type aliases, enums, class fields, DI metadata,
  Angular decorators, route arrays, and provider arrays are not represented as
  first-class chunks or relations.
- `CALLS` relations for JavaScript/TypeScript are exact same-file chunk-name
  matches; cross-file calls through imports and class/DI aliases are usually
  lost.
- Some real Angular TypeScript files trigger parser/walker failures such as
  duplicate decorator-era declarations or missing `TSAnyKeyword` walker support.
- Benchmark summaries show unsupported counts but not unsupported breakdown by
  extension, so coverage loss is hard to diagnose from the site data alone.

## Required Output

- Changed files/entities or findings.
- Tests run and results.
- Risks introduced or closed.
- Open decisions for the manager.

## Acceptance

- A fresh agent can reproduce the poor Angular score from the published JSON
  and identify which work order targets each cause.
- Any implementation PR includes focused parser/ingest tests and, when
  benchmark output changes, a bootstrapbench smoke or fixture-level regression.
- Manager records any remaining benchmark coverage gaps in `risk-register.md`.
