# Acceptance Matrix

This matrix maps the project's requirement issues to implementation surfaces
and validation gates.

| Issue | Goal | Current Coverage | Required Implementation | Required Validation | Status |
|---|---|---|---|---|---|
| REQ-1 | Keep Cortex's MCP context layer accurate, ranked, and local-first. | MCP server, RyuGraph load, embeddings, rules, and search tests exist. | `scaffold/mcp/src`, `.context` scaffold, search/ranking, graph, embeddings, daemon/hook surfaces. | `npm test` in `scaffold/mcp`; affected root parser/search tests; security/privacy review for network or persistence changes. | Not ready |
| REQ-2 | Keep CLI init/bootstrap/update flows reliable for real repos. | Root tests cover init, scaffold, parsers, hooks, dashboard, and bootstrapbench helpers. | `bin/`, `scripts/`, `scaffold/`, `.githooks`, parser setup scripts, generated scaffold docs. | Root `npm test`; targeted parser/bootstrap tests; `cortex update` after substantial changes. | Not ready |
| REQ-3 | Preserve parser, ingest, and embedding performance while expanding language coverage. | Tree-sitter/parser tests and benchmark harness exist; C# parser is optional when `dotnet` is unavailable. | Parser implementations, ingest scheduler, embedding scheduler, bootstrapbench harness and fixtures. | Root ingest/parser tests; `scaffold/mcp` tests when embeddings/graph are touched; benchmark smoke when harness behavior changes. | Not ready |
| REQ-4 | Ship safe releases across npm, plugin metadata, and generated scaffold assets. | Release bump/publish workflows and version sync script exist. | `package.json`, `server.json`, plugin manifests, release workflows, packaged files, changelog/readme notes. | `npm run release:check-version-sync`; root tests; MCP build/tests; workflow review for permissions and publish path. | Not ready |
| REQ-5 | Keep the website and bootstrap benchmark pages deployable and data-backed. | Frontend build, Pages workflow, benchmark exporter, and static `site-data/` are present. | `frontend/`, `.github/workflows/pages.yml`, `benchmark/bootstrapbench/`, `site-data/`. | `npm ci`, `npm run build`, and `npm audit --audit-level=high` in `frontend`; live Pages smoke for site changes. | Not ready |
| REQ-6 | Keep agent/process control useful without slowing small maintenance PRs. | Baton docs are installed; Cortex MCP usage is required by `CLAUDE.md`/`AGENTS.md`. | `docs/agent-control/`, `CLAUDE.md`, agent command docs, PR/work-order traceability when using Baton. | Docs review; no ledgers mutated except during real work orders; ensure small Dependabot/docs PRs can still use a lightweight path. | Not ready |
| REQ-7 | Improve JS/TS and Angular benchmark quality so successful bootstrap runs reflect useful semantic context. | Cortex 2.0.19 Angular run is `ok` but has `4.57 chunks/KLOC`, `93.35%` isolated chunks, `.mts`/template/style gaps, and same-file-only JS/TS `CALLS`. WO-001 and WO-004 are now implemented locally. | Remaining WO-002, WO-003, and WO-005: Angular resource extraction, cross-file call resolution, and monorepo source-scope diagnostics. | Focused parser/ingest tests; bootstrapbench stats/aggregate tests; minimal Angular fixture; rerun or fixture-level benchmark evidence showing better chunk yield/connectivity and explainable unsupported counts. Full `npm test` passed 2026-06-16 for WO-001/WO-004. | Partial |
| REQ-8 | Keep Cortex usable on large repositories by bounding peak memory in bootstrap, ingest, embed, graph-load, and MCP startup. | First-pass memory reductions are implemented locally: bootstrapbench RSS sampling/aggregation, graph CSV streaming, embedding JSONL streaming and scheduler callback consumption, ingest streaming writes and lower worker content duplication. | Continue deeper retention work: streaming `GraphData`, lazy embed entity/search result handling, C# batch caps, and real benchmark thresholds. | Full root `npm test` passed 2026-06-16; `scaffold/mcp` `npm test` passed 319/319; focused ingest/bootstrapbench tests passed. Still required: max-RSS/time benchmark on Cortex, Angular, and one mixed-language repo with pass/fail thresholds. | Partial |
| REQ-9 | Make Cortex CLI-first so local station agents can query graph+RAG context through shell commands without MCP setup. | WO-016 through WO-019 are implemented locally: CLI retrieval commands support JSON envelopes, `cortex init` skips MCP client registration by default, runtime helpers/scripts use neutral context-runtime naming while preserving `.context/mcp`, and docs/scaffold/release wording now position CLI as primary with MCP compatibility retained. | No remaining implementation work in the CLI-first migration plan. Future package rename, `.context/mcp` removal, `cortex mcp` removal, or registry support removal is explicitly a breaking-release or parallel-package decision. | Explorer audits completed; focused CLI/init/scaffold/runtime tests passed; MCP test suite passed 325/325; full root `npm test` passed 195/195; `npm run release:check-version-sync` passed; npm pack dry-run excludes generated scaffold artifacts. | Implemented locally |
| REQ-10 | Improve embedding throughput without reducing semantic retrieval quality. | Current Jina/default embedding policy is quality-first and memory-aware. WO-020 added an explicit experimental `CORTEX_EMBED_TEXT_PROFILE=compact-files` profile for large file-level records only; chunks remain full, and cache/log/manifest behavior is explicit. Cortex/bat quick gate and Angular capped-control gate had 0 lost expected hits. The Cortex query pack is calibrated to existing pinned paths/symbols; calibrated retrieval quality improved from 15/35 to 29/35 expected hits after ranking/tokenization fixes, with compact-files still disabled. Angular 2048 compact-files rerun with the latest ranking improved from 20/42 to 22/42 expected hits. | Keep compact-files opt-in unless broader validation passes; rerun compact-files against the calibrated Cortex gate, run fastjson2 before promotion, and do not change the default model without benchmark evidence. Remaining Cortex/Angular quality misses should be handled as retrieval-ranking follow-up before using compact-files as a default speed answer. | Before/after bootstrapbench on the same repos, model, config, and cache policy. Required metrics: total/bootstrap embed time, peak RSS, entity/chunk counts, embedded/reused/failed counts, and fixed-query retrieval quality with top-k/rank comparisons. | Partial |

## Global Acceptance Requirements

- Baton work orders use a feature branch or worktree. Direct `main` changes are
  only allowed for explicit user-requested maintenance, release, or merge tasks.
- Code answers and reviews use Cortex context first. Prefer
  `cortex ... --json` commands (`search`, `related`, `rules`, `impact`,
  `explain`) for local agents; MCP `context.*` tools remain acceptable when the
  client exposes them explicitly.
- Validation is path-based but explicit: root `npm test` for core/package
  changes; `npm test` in `scaffold/mcp` for MCP server changes; frontend
  `npm ci`, `npm run build`, and `npm audit --audit-level=high` for website
  or build-tool changes.
- `npm run release:check-version-sync` runs whenever package metadata,
  release workflows, plugin manifests, or versioned docs are touched.
- No change may introduce source-code upload, telemetry, external services, or
  secrets handling without an explicit manager decision and Security and Privacy review.
- Website and benchmark changes require a Pages artifact/build check; after a
  deploy-affecting merge, record a live smoke result for
  `https://danielblomma.github.io/cortex/`.
- Version bumps are required for shipped runtime/package behavior changes, but
  not for docs-only, benchmark-site-only, or frontend dependency maintenance
  unless the manager asks for a release.

## PR / Feature Traceability

Every PR must name its work order and feature issues in its body, and this
table must be updated when a PR opens or merges. The merge gate fails if a PR
is not mapped here.

| PR | Work Order | Feature Issues | Scope |
|---|---|---|---|
| #96 | WO-001, WO-004, WO-007 through WO-014 | R6, R8, R10 | Angular parser/ingest coverage, bootstrapbench coverage/RSS diagnostics, graph/embed/ingest memory first pass, ingest memory trace, worker-result streaming. |
| #97 | Follow-up optional parser tooling fix | R5 | C# and VB.NET parser bridge publish uses `/p:UseAppHost=false` to avoid macOS apphost signing failures. |
