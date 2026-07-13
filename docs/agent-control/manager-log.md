# Manager Log

Durable chronological log for scope, decisions, approvals, blockers, and staging status.
Do not rely on chat memory for acceptance or merge decisions.

Rotation rule: at each day rollover (or at ~150 lines), move the previous day's
entries to `archive/manager-log-YYYY-MM-DD.md` and refresh Current State. This
file must stay small enough that a fresh manager session can read it whole.

## Current State (2026-06-23)

<!-- The fresh-manager test applies to this section: a brand-new manager
     session must be able to continue from here with zero chat history.
     Summarize: accepted/merged work orders, work orders with open evidence
     gates, next planned work orders, and open tooling risks. -->

- PR #96 and PR #97 merged and released as `v2.1.4`. Angular/parser/benchmark
  and first-pass memory improvements are on `main`.
- User decision on 2026-06-18: move Cortex from MCP-first to CLI-first for
  local station agents. CLI retrieval parity is implemented locally; do not
  remove MCP code or `.context/mcp` runtime path without a breaking-release or
  parallel-package plan.
- CLI-first migration packet
  `docs/agent-control/context-packets/008-cli-first-migration.md` is completed
  locally through WO-019. R11 remains the guardrail for any future MCP
  compatibility removal or package rename.
- Active embedding/token work: WO-020 uses context packet
  `docs/agent-control/context-packets/009-embedding-token-performance.md`.
  The plan now requires a before/after benchmark before implementation: same
  repos, model, bootstrapbench config/cache policy, and metrics for embed time,
  peak RSS, entity/chunk counts, and retrieval quality.

## Open Decisions

<!-- Decisions the manager has explicitly deferred, one bullet each. -->

- Whether `cortex mcp` is deprecated for one release or removed directly in a
  future breaking release.
- Whether `@danielblomma/cortex-mcp` is retained as the npm package name during
  the CLI-first migration or followed by a new package with a migration window.

## Closed Decisions

- `origin/perf/embed-scheduler` and `origin/perf/bootstrap-stage-optimizations`
  should not be merged for the memory work. The first is already in
  `origin/main`; the second is stale/superseded and its scoped bootstrap files
  are already mirrored in `origin/main`.
- Angular semantic-quality follow-up is deferred until after the current
  memory/PR-readiness pass. Do not start WO-002, WO-003, or WO-005 during
  WO-010 through WO-012.

## 2026-06-15

<!-- Chronological entries for the current day. -->

- Analyzed poor `angular/angular` bootstrapbench result using Cortex MCP,
  local benchmark data, and two explorer agents. Root causes are parser/ingest
  coverage gaps, same-file-only JS/TS `CALLS`, unsupported Angular resources
  and `.mts`, broad monorepo source detection, and missing benchmark
  unsupported-extension diagnostics. Created WO-001 through WO-005.

## 2026-06-16

- Implemented WO-001 locally after assigning the parser/ingest scope: JS/TS
  parser registration now covers `.tsx`, `.jsx`, `.mts`, and `.cts`; ingest
  recognizes `.mts`/`.cts`; the JS/TS walker handles common Angular TypeScript
  and JSX nodes; chunk discovery emits interface/type/enum declarations and
  class-field function chunks.
- Implemented WO-004 benchmark diagnostics. A benchmark worker started the
  bootstrapbench changes but disconnected before completion; manager finished
  validation locally. Stats exports now include workspace coverage diagnostics,
  unsupported/skipped extension breakdowns, and parser-eligibility counts.
- Validation: targeted parser/ingest/bootstrapbench tests passed, syntax checks
  passed, and full `npm test` passed with 182 passing, 5 skipped optional
  VB.NET live parser tests, 0 failures.
- Remaining parser risk: Angular `packages/core/src/metadata/directives.ts` at
  commit `71bb19d772aa77a30922fb896f775b58a0862c36` still fails Babel parsing
  due to duplicate type/value declaration handling. Do not apply unsafe parser
  workarounds without a dedicated follow-up.
- Review iteration fixed three findings: JSX walkers now descend into markup so
  imported components and calls in expression containers are retained; TS
  declaration member/type-literal nodes now expose imported type dependencies;
  bootstrapbench workspace candidate collection de-duplicates overlapping
  source paths. Validation after review: targeted parser/bootstrapbench tests,
  syntax checks, and final full `npm test` passed with 185 passing, 5 skipped,
  0 failures.
- Started WO-006 memory regression audit using four read-only explorer agents:
  branch regression, graph-load memory, embedding/search memory, and
  ingest/worker memory. Initial local evidence: `origin/perf/embed-scheduler`
  is already an ancestor of `origin/main`; `origin/perf/bootstrap-stage-
  optimizations` is stale and merge-tree reports a `package.json` conflict.
  Added REQ-8 and risks R8-R10.
- Completed WO-006 explorer handoffs. Branch disposition: do not merge
  `origin/perf/embed-scheduler` because it is already in `origin/main`; do not
  merge `origin/perf/bootstrap-stage-optimizations` because its scoped
  bootstrap implementation is already mirrored in `origin/main` and the branch
  is stale/superseded. Treat memory risks as present in `main`, not isolated to
  Norbert's draft branches.
- Memory plan after WO-006: first add a repeatable RSS/time benchmark gate for
  ingest, embed, graph-load, and MCP search startup; then run WO-007 graph-load
  streaming CSV/JSONL, WO-008 embedding/search streaming and vector retention
  reductions, and WO-009 ingest/worker memory reductions with output-equivalence
  tests at each step.
- Implemented the memory first pass with three worker agents plus manager
  integration. Benchmarkbench now records optional RSS samples in
  `timings.memory`, exports per-run `memory`, and aggregates peak RSS by repo,
  model, and phase. WO-007 streams graph bulk CSV rows and edge filtering.
  WO-008 streams MCP JSONL embedding reads/writes and consumes scheduler
  vectors through an `onVector` callback. WO-009 streams ingest JSONL/TSV
  output, avoids sending file content in worker task lists, deletes merged
  worker results, and removes the retained lowercase file-content map.
- Validation after memory pass: `node --test tests/bootstrapbench-stats.test.mjs
  tests/bootstrapbench-aggregate.test.mjs` passed 33/33; `npm test` in
  `scaffold/mcp` passed 319/319; combined ingest/bootstrapbench focused tests
  passed 79/79; syntax checks and `git diff --check` passed; full root
  `npm test` passed with 188 passing, 5 skipped optional VB.NET live parser
  tests, 0 failures. `cortex update` and MCP `context.reload` completed with
  the existing `dotnet ENOENT` C# parser warning; `cortex watch status` is
  stopped.
- Remaining memory risks after first pass: graph load still materializes parsed
  `GraphData`; embed still materializes entity arrays before sorting; MCP
  search top-k remains a later optimization; ingest still retains
  `fileRecords.content`, token maps, and C# batch payloads. Worker parsing now
  assumes files remain stable between initial file scan and worker re-read.
- Ran memory RSS benchmark `memory-rss-2026-06-16` for Cortex and Angular only
  after correcting an accidental third mixed-repo item. Final summary is 2/2
  succeeded: Cortex max RSS 611.27 MB in `embed`; Angular max RSS 1221.68 MB in
  `ingest`, with `embed` taking 639476 ms. Angular produced 22742 chunks and
  70739 edges, with 2122 unsupported files and 626 text-supported/no-parser
  files. The aborted third item directory was removed from the ignored results
  tree.
- User decision: do not prioritize C# memory work on this machine because
  `dotnet` is unavailable locally and Angular's measured peak is in generic
  ingest, not C#. Next memory work should instrument and reduce Angular ingest
  retention first: `fileRecords.content`, chunk/relation materialization, and
  token/rule-match maps.
- Installed .NET 8 SDK locally under `~/.dotnet` and linked `dotnet` from
  `/opt/homebrew/bin/dotnet`. Homebrew cask install was not usable in this
  non-interactive session because the macOS pkg requires `sudo`; the user-local
  installer succeeded with SDK 8.0.422 / runtime 8.0.28. C# first-use publish
  initially failed on macOS apphost signing (`NETSDK1177`), so the C# and
  VB.NET parser bridges now publish with `/p:UseAppHost=false`, matching the
  existing `dotnet <dll>` execution model. Validation: C#/VB.NET parser tests
  passed 25/25, `cortex update` completed, and status now reports
  `csharp_parser available=true`.
- Started next agent pass per user direction. Created context packets
  `003-ingest-memory-trace.md`, `004-memory-benchmark-analysis.md`, and
  `005-clean-pr-readiness.md`; assigned WO-010 and WO-012 immediately, with
  WO-011 pending WO-010 trace availability. Angular quality decision remains
  explicitly deferred until after this pass.
- WO-010 returned and was accepted for the next benchmark: ingest now has
  opt-in `CORTEX_INGEST_TRACE_MEMORY` JSONL checkpoints, and focused ingest
  trace tests passed. WO-011 then ran `memory-rss-trace-2026-06-16`: Cortex and
  Angular both succeeded. Angular peak process-tree RSS was 1359.15 MB in
  ingest; manual trace showed main-process growth from 230.10 MB at
  `parse:workers_start` to 459.82 MB at `parse:workers_complete` with 7294
  retained worker results. Decision: start WO-013 to bound/stream worker
  result handling while preserving deterministic merge order. Angular
  semantic-quality decisions remain deferred.
- WO-013 returned with streaming worker result consumption in
  `scaffold/scripts/ingest.mjs`; merge remains in sorted `fileRecords` order
  and fallback behavior is covered. Manager reran focused ingest tests
  (47/47) and full root `npm test` (193/193), both green. Started WO-014 for a
  real Cortex/Angular RSS and trace comparison after the worker-streaming
  change.
- WO-014 returned and was accepted for planning. `memory-rss-stream-2026-06-16`
  succeeded 2/2. Compared with `memory-rss-trace-2026-06-16`, Cortex peak was
  609.57 MB vs 614.94 MB, while Angular peak was 1373.12 MB vs 1359.15 MB,
  still in ingest. Manual Angular trace confirms WO-013 worked as scoped:
  `worker_results_retained=0`, `worker_results_retained_peak=436`,
  `worker_results_consumed=7294`, and `worker_results_pending=0`. Main-process
  trace now points at token/rule matching and post-parse materialization:
  `tokens:rule_matching_complete` rose to 639.89 MB from 596.51 MB at
  rule-match start. Decision point: either make one more small memory pass on
  token/rule matching, or pause memory and make the deferred Angular quality
  decision.
- Created PR #96 from `perf/angular-memory-ingest` for the combined
  Angular/benchmark/memory work. It intentionally excludes `.gitignore`,
  `WORKPLAN-2.1.0.md`, `cortex-2.1.0-changes.patch`, and the .NET parser
  publish fix. Created PR #97 from `fix/dotnet-parser-apphost` for the C# and
  VB.NET `/p:UseAppHost=false` publish fix, validated with live C#/VB parser
  tests. The temporary worktree for #97 was removed after pushing.

## 2026-06-18

- User decided Cortex should become CLI-first/CLI-only for local station usage:
  agents should call `cortex ... --json` through the terminal instead of
  depending on MCP. Created context packet `008-cli-first-migration.md`,
  work orders WO-015 through WO-019, REQ-9, and risk R11. Started three
  explorer agents to audit CLI/MCP coupling, runtime query extraction, and
  docs/scaffold/release impact.
- Explorer findings: keep `.context/mcp` as a temporary runtime path because
  embed, graph-load, frontmatter, memory scripts, and existing MCP
  compatibility depend on it; first implementation should add CLI retrieval
  parity and then separate MCP client registration from indexing/bootstrap.
- Implemented WO-016 locally. Added `cortex search`, `cortex related`,
  `cortex impact`, `cortex rules`, and `cortex explain` dispatch through a new
  query CLI runtime that reuses `runContextSearch`, `runContextRelated`,
  `runContextImpact`, and `runContextRules`. JSON mode emits a stable
  `{ ok, command, input, context_source, warning, data }` envelope. Validation:
  MCP test suite passed 325/325, full root `npm test` passed 193/193, and the
  top-level query shim test passed. MCP defaults are unchanged; next planned
  work is WO-017 client-registration separation.
- Implemented WO-017 locally. `cortex init` now skips MCP client registration
  by default, while `cortex init --connect` and `cortex connect` remain the
  explicit compatibility path for Codex/Claude MCP registration. Focused tests
  run with an isolated `PATH` so no real local client configuration is touched.
  Validation: focused init/scaffold/query tests passed, MCP test suite passed
  325/325, and full root `npm test` passed 195/195. Next planned work is
  WO-018 runtime naming/shim.
- Implemented WO-018 locally. Added neutral context-runtime naming around the
  existing `.context/mcp` package path: CLI daemon/hook/stage/run/query shims
  resolve through `resolveProjectRuntimeDist`, bootstrap/embed/graph-load/doctor
  scripts expose `CONTEXT_RUNTIME_DIR` with `MCP_DIR` retained as a compatibility
  alias, and memory scripts import shared frontmatter helpers through
  `CONTEXT_RUNTIME_DIST`. Updated bootstrapbench timing detection to accept both
  old `Installing MCP dependencies` logs and new `Installing context runtime
  dependencies` logs. Validation: focused syntax/static tests passed, full root
  `npm test` passed 195/195, MCP test suite passed 325/325, and
  `git diff --check` passed. Remaining CLI-first work is WO-019 docs/package/
  release positioning and deprecation policy.
- Implemented WO-019 locally and completed the CLI-first migration plan. README,
  scaffold `AGENTS.md`/`CLAUDE.md`, live repo `AGENTS.md`/`CLAUDE.md`, scaffold
  architecture docs, plugin description, release workflow labels, and package
  metadata now position CLI retrieval as primary while retaining MCP as a
  compatibility bridge. Decision: keep `@danielblomma/cortex-mcp`,
  `cortex mcp`, `.context/mcp`, `server.json`, and plugin MCP install metadata
  for this non-breaking release; any removal or rename is a future breaking or
  parallel-package plan. Fixed release packaging drift by syncing
  `package-lock.json`, replacing a missing `docs/MCP_MARKETPLACE.md` package
  entry with `mcp-registry-submission.json`, and narrowing npm package contents
  so generated scaffold cache/db/parser build artifacts are not packed.
  Validation: two explorer audits completed; focused init/scaffold/query tests
  passed 15/15; `npm run release:check-version-sync` passed; npm pack dry-run
  reported 245 files, 1.6 MB unpacked, zero generated scaffold artifacts; full
  root `npm test` passed 195/195; `git diff --check` passed.

## 2026-06-23

- Refreshed WO-020 embedding/token performance planning per user request.
  Before/after benchmarking is now a required gate before implementation:
  record the baseline command/result when feasible, run the after-change with
  the same repos/model/config/cache policy, and compare embed time, peak RSS,
  entity/chunk counts, and fixed-query semantic retrieval quality. Added
  REQ-10 and R12 so speedups cannot be accepted if semantic quality regresses.
- Created semantic quality query pack v1 under
  `benchmark/bootstrapbench/query-packs/semantic-quality-v1/`: 8 English
  task-like queries per repo for Cortex, bat, Angular, and fastjson2. Queries
  are agent-drafted with expected hits and rationale; next step is baseline
  execution and review before implementing any after-strategy.
- Added `benchmark/bootstrapbench/run-query-pack.mjs` and ran quick baseline
  `semantic-quality-quick-baseline-20260623`. Cortex needed query-pack source
  paths added in the isolated workspace, then found 7/39 expected hits in
  top 10. `sharkdp/bat` default full-context Jina embedding was killed by the
  OS; explicit capped-control embedding with `CORTEX_EMBED_MAX_TOKENS=2048`
  and `CORTEX_EMBED_THREADS=4` succeeded and found 25/40 expected hits in
  top 10. Decision implication: before implementing `compact-files`, keep the
  default-OOM as a memory/preflight finding and use found-before hits as the
  first after-run no-regression set.
- Implemented `CORTEX_EMBED_TEXT_PROFILE=compact-files` as an explicit,
  opt-in file-level embedding text profile. It compacts only large `File`
  entities and keeps chunk bodies full. Review iteration fixed over-budget
  signal-line handling and narrowed cache signatures per entity so non-file
  records keep the default token-cap profile. Logs and manifests now expose
  text-profile stats and `signature_profiles`. Validation: MCP test suite
  passed 340/340; root `npm test` passed 216/216 before the reviewfix; query-pack
  tests passed.
- Ran final after quick gate
  `semantic-quality-quick-compact-files-reviewfix-20260624`. Cortex
  re-bootstrap matched baseline entity shape (175 files, 789 chunks, 988
  embeddings), compacted 5 file entities, saved 144,422 chars, reused 169,
  failed 0, and kept query-pack recall at 7/39 with 0 lost expected hits.
  `sharkdp/bat` re-bootstrap used the baseline capped-control env
  (`CORTEX_EMBED_MAX_TOKENS=2048` and `CORTEX_EMBED_THREADS=4`), compacted 12
  file entities, saved 423,748 chars, reused 420, failed 0, and kept query-pack
  recall at 25/40 with 0 lost expected hits. Remaining gap: Angular and
  fastjson2 before/after if compact-files is promoted beyond explicit
  experimental use.
- Ran Angular compact-files follow-up on
  `angular/angular@71bb19d772aa77a30922fb896f775b58a0862c36` with query-pack
  source paths narrowed to `packages/compiler-cli`, `packages/core`,
  `packages/compiler`, `packages/router`, `packages/platform-browser`, and
  `README.md`. Uncapped baseline at 8192 was killed during embedding and fell
  back to lexical-only search (17/42 expected hits); uncapped compact-files
  succeeded with 16,314 embeddings, compacted 142 file entities, saved
  4,665,248 chars, failed 0, and found 19/42 expected hits. Because baseline
  was lexical-only, a capped-control gate was also run with
  `CORTEX_EMBED_MAX_TOKENS=2048`: baseline and compact-files both found 20/42
  expected hits with lost 0/gained 0; only two retained hits moved one rank
  inside top 10. Interpretation: no Angular semantic regression in the
  capped-control gate, but compact-files alone is still too slow for Angular
  as a default performance answer.

## 2026-06-25

- Started Cortex query-pack calibration after user flagged `7/39` as
  unacceptable. Audit showed the original Cortex baseline was partly measuring
  a broken gate: 21/39 expected hits pointed at files absent from the pinned
  workspace index, mostly `scripts/...` paths that should have been
  `scaffold/scripts/...`. Updated `danielblomma__cortex.jsonl` expected paths,
  changed non-chunkable expected symbols to file-level hits, added
  `scaffold/scripts` to the persisted pinned workspace source paths, and
  reindexed. Validation: query-pack tests passed 3/3; calibrated expected hits
  are 35 total with 0 missing files and 0 missing symbols.
- Ran calibrated Cortex baseline
  `semantic-quality-cortex-calibrated-baseline-20260624`: 229 indexed files,
  1,163 chunks, 1,423 embedding entities, 615 embedded, 808 reused, failed 0.
  Query result improved from the old 7/39 to 15/35. This is now a valid
  retrieval-quality baseline, and the remaining 20 misses should be treated as
  real ranking/retrieval work rather than query-pack path defects.
- Paused compact-files follow-up to fix Cortex retrieval quality first.
  Implemented ranking/tokenization improvements in the MCP search runtime:
  code-aware tokenization for camel-case and language aliases, structural
  boosts for path/symbol/kind matches, query-token expansions for local
  Cortex terms, semantic-confidence scaling for graph/trust/recency signals,
  bounded top-k diversity, and a small test-evidence boost. Validation:
  `npm --prefix scaffold/mcp test` passed 346/346,
  `node --test tests/bootstrapbench-query-packs.test.mjs` passed 3/3, and
  `git diff --check` passed. Final calibrated Cortex quality run
  `semantic-quality-cortex-ranking-final2-20260625` improved from 15/35
  expected hits (42.86%) to 29/35 (82.86%) without enabling compact-files.
  A review follow-up fixed alias scoring so expansions do not dilute lexical
  relevance and sorted diversified result sets by their displayed score.
  Remaining known misses are six expected hits across config/status,
  graph/query implementation, and one JS scope helper; treat those as the next
  retrieval-quality follow-up rather than compact-files work.
- Ran Angular follow-up against the latest retrieval-quality runtime on the
  pinned Angular workspace
  `angular/angular@71bb19d772aa77a30922fb896f775b58a0862c36`. The previous
  clean semantic baselines were both 20/42 expected hits for 2048-token Jina:
  full file text and compact-files. A full-profile re-embed was started but
  stopped because it was unnecessary for ranking validation; the workspace
  reused the existing 2048 compact-files embeddings (`failed=0`) and rebuilt
  the graph with the new runtime. Query run
  `semantic-quality-angular-2048-compact-ranking-final2-20260625` found 22/42
  expected hits (52.38%), up from 20/42 (47.62%). Net movement was +2 expected
  hits: gained five within top 10 and lost three, with remaining weakness
  concentrated in compiler/defer pipeline, DI provider helpers, router
  activation/outlet, and hydration annotate/defer compiler tests.
- Tested the proposed Angular/Cortex retrieval follow-up ideas and rejected
  them because they regressed query-pack quality. Strict path-fusion plus
  query-aspects fell to Cortex 26/35 and Angular 19/42; path-fusion only fell
  to Cortex 28/35 and Angular 21/42; stronger soft-fusion fell to Cortex 26/35
  and Angular 20/42; tokenizer inflection variants fell further or produced
  query errors. No failed experiment code is retained; the accepted runtime
  remains the 29/35 Cortex and 22/42 Angular ranking fix above. Important
  validation note: the later rollback-confirm runs are invalid because
  re-running `init --force` plus incremental update inside the benchmark
  workspaces caused the local `.context` index to drop files. Rebootstrap the
  Cortex and Angular benchmark workspaces before trusting any further local
  quality gates.
- Rebootstrapped the damaged benchmark workspaces and reran sanity checks.
  Cortex workspace now has 229 files, 1,163 chunks, 1,423 embeddings, and
  query-pack run `semantic-quality-cortex-rebootstrap-check-20260625` is back
  at 29/35 expected hits (82.86%). Angular workspace now has 4,261 files,
  11,657 chunks, 16,314 embeddings with `CORTEX_EMBED_MAX_TOKENS=2048` and
  `CORTEX_EMBED_TEXT_PROFILE=compact-files`, failed=0, and query-pack run
  `semantic-quality-angular-rebootstrap-check-20260625` is back at 22/42
  expected hits (52.38%).
- User decision: new repositories should initialize Cortex with repo-root
  indexing by default, not narrowed auto-detected source paths. Implemented
  `source_paths: ["."]` for newly generated configs while keeping existing
  configs preserved on re-init. Ingest now normalizes `.` correctly for
  incremental `--changed` runs, excludes `.context` in both full and changed
  modes, indexes root-level `bin/` source, and still skips nested generated
  `bin/` output. Agent review found the incremental/root-bin risks and
  confirmed the final fix. Validation: focused init/ingest tests passed,
  `git diff --check` passed, and full root `npm test` passed 216/216.
- Reran the Cortex semantic query pack against a clean detached workspace at
  the pack SHA `051d4e6a87d968795482f65d900eda5dc8a94aae` initialized with the
  new repo-root default (`source_paths: ["."]`, `.context` excluded). Bootstrap
  produced 251 files, 1,207 chunks, and 1,493 embeddings with failed=0. Default
  generated ranking weights (`semantic=0.55`, `graph=0.10`) found 27/35
  expected hits in `semantic-quality-cortex-root-source-pinned-20260625-1540`,
  down from the accepted 29/35. A query-only isolation rerun on the same index
  with the prior calibrated weights (`semantic=0.40`, `graph=0.25`) returned to
  29/35 in `semantic-quality-cortex-root-source-pinned-oldweights-20260625-1540`.
  Conclusion: repo-root indexing is not the regression; the new default ranking
  weights should be corrected or benchmark-gated before release.

## 2026-06-26

- Corrected the repo-root generated ranking defaults back to the calibrated
  profile (`semantic=0.40`, `graph=0.25`) and synced the MCP runtime
  `DEFAULT_RANKING` fallback to match. Added regression assertions for both
  generated config and runtime fallback. Query-only rerun on the same
  root-source Cortex index, without re-embedding, produced
  `semantic-quality-cortex-root-source-restored-defaults-20260626`: 29/35
  expected hits (82.86%), up from the regressed 27/35. The recovered hits were
  both in `cortex-semantic-005`, returning it from 3/5 to 5/5.

## 2026-07-12

- Accepted WO-021 after independent Code Quality, Contract, and Validation
  review. Every finding was fixed in iteration; no deferrals remain. The new
  `cortex pattern-evidence` command ranks separately by file/module/feature/repo
  locality from one graph and embedding snapshot, emits cited chunk lines and
  explicit fallback state, and uses stable reference time and equal-score
  ordering. Final validation: pattern/query 17/17, ranking 13/13, MCP 357/357,
  root 216/216 plus 81 context regressions, deterministic live JSON, strict
  malformed-flag errors, version-sync, 247-file npm pack dry-run, and clean
  diff. Release metadata is synced to 2.3.0.
- Accepted WO-022 after independent Code Quality, Contract, Security and
  Privacy, and Validation review. Every finding was fixed in iteration; no
  deferrals remain. Enterprise `context.review` now returns bounded,
  lexical-only `pattern_review` context for deterministic changed and untracked
  targets. Results use uniform cited status envelopes and sanitized diagnostics;
  audit metadata contains counts and query length only. Pattern evidence stays
  advisory and does not alter validator, workflow, trust, or policy pass/fail.
  Final validation: focused pattern/review 14/14, MCP 364/364, root 216/216 plus
  81 context regressions, build, version-sync, 250-file npm pack dry-run, and
  clean diff. WO-022 and REQ-11 are accepted locally for 2.3.0.

## 2026-07-13

- WO-023 assigned (context packet 013): native agent integration and session
  bootstrap on branch `feat/native-agent-integration`. Design spec approved
  by the user; REQ-12 added to the acceptance matrix.

## Archive

<!-- list rotated archive files here, e.g.
- `archive/manager-log-2026-01-01.md` — foundation, WO-001–WO-003.
-->
