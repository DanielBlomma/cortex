# WO-047 Release 2.5.0 Integration Results

Date: 2026-08-20

## State

Review rounds 1 and 2 were NO-GO. All containment, generation-integrity,
atomic lock-publication, worker-handshake, release-workflow, changelog, audit,
and evidence findings are now fixed, and the candidate is frozen for a third
independent review. Version metadata remains `2.4.2`; the authorized
release-bump workflow will perform the minor bump only after the release PR is
accepted and merged.

## Integrated Candidate

- Accepted WO-033/034 source, control, output, cache, dashboard, staging, and
  manifest-last containment remains the base.
- Accepted WO-035 dependency and packed-artifact gates remain enabled in both
  release workflows.
- Accepted WO-046 adds opt-in progressive background indexing, explicit
  status/pause/resume control, generation-wide exclusion, atomic resumable
  semantic snapshots, and versioned atomic graph publication with retention.
- Review fixes validate every cache, DB, import, staging, manifest, graph, and
  semantic-reader ancestor/leaf against the project root before I/O; validate
  progressive `graph_generation` against the published graph; atomically
  publish fully initialized, fsynced, token-bound lock ownership; and require a
  strict matching `vX.Y.Z` tag before Release Publish performs checkout or
  mutation.
- Foreground remains the default. macOS, Linux, and WSL are supported; native
  Windows background mode rejects explicitly.
- WO-036 through WO-045 retrieval/ranking experiments and local
  `.context/config.yaml` changes are absent.

## Frozen Angular Binding

The accepted WO-046 report and first WO-047 report are superseded because
review fixes changed bound source files. The round-2 ignored final report is:

`benchmark/bootstrapbench/results/wo047-progressive-angular-20260820-frozen-final/evidence/report.json`

- Report SHA-256:
  `222fd8875592a1240bc6d8eecde2ee6e721813eee49b9c2e153ebc329c7ae24c`.
- Harness SHA-256:
  `ad3a607b1a546416de99aaded1c9444baebf0c130faf14b19966ee456cbfad30`.
- Angular origin: `https://github.com/angular/angular.git`; detached HEAD:
  `71bb19d772aa77a30922fb896f775b58a0862c36`.
- The fresh checkout uses the accepted six-path source scope:
  `packages/compiler-cli`, `packages/core`, `packages/compiler`,
  `packages/router`, `packages/platform-browser`, and `README.md`.
  Generated context-config SHA-256 is
  `39aa1615e58b2a22f899843b8e5c3202d2dbb334126a554455c935da876706e5`;
  the report binds both the scope and hash.
- All 14 installed/source bindings are equal. Search-ready took 26.751 seconds,
  the background CLI returned in 28.349 seconds, and semantic completion took
  290.588 seconds.
- A real SIGTERM interrupted the exact 4,129-record checkpoint. A new PID and
  run id resumed from it; final status is 16,314/16,314 with zero failures.
- Progressive and independent foreground JSONL SHA-256 are both
  `98189f4bdf1bd44d9be8e3a2dd3362c72ef79194ddae8635581fd07421a78b62`.
  Byte parity and query parity are both true. The final and foreground query
  summaries are 8/8 successful, 19/42 expected hits, and 45.24% expected
  recall; lexical+graph readiness was independently queryable at 0% semantics.
- A cold-start attempt exposed and fixed missing-canonical-snapshot handling.
  A later full-`.`-scope attempt was stopped and superseded after packet 009
  confirmed that the accepted comparable contract is the six-path scope.
- After final hash verification, the isolated Angular checkout and all failed
  or superseded temporary evidence directories were moved from `/tmp` to the
  user's Trash for recoverable cleanup. The ignored final report above remains
  in the release worktree.

## Packed Candidate

The packed harness derives the complete managed candidate diff from the
candidate artifact and the published `@danielblomma/cortex-mcp@2.4.2`
artifact rather than from `HEAD` or a tag source archive, so an uncommitted
review candidate cannot escape upgrade validation. The previous tarball is
bound to SHA-1 `995ddb990eedf26f833be5f511a2cf45b9671d6a` and its recorded SRI.

- Package inventory: 420 entries, 399 at `0644`, 21 at `0755`.
- Sorted path/mode SHA-256:
  `cebf97a2b13ef48733d79b97b0c7785d3152915e0b5ab6706190a836e38b48bd`.
- Ownership: 385 unique managed paths and 94 packaged runtime-script paths.
- Installed artifact: boundary 41/41, characterization 3/3, development
  dashboard 4/4, packaged dashboard 4/4.
- Verified published-`v2.4.2` force-upgrade: 38 changed managed files, five
  new, and 38 installed state hashes; config, ontology, and unknown content
  preserved.

## Validation

- Focused progressive CLI lifecycle/lock tests 17/17, Angular helpers 2/2,
  and release workflow/plugin contracts 9/9. Four parallel repeated worker
  handshake fixture loops passed 16/16 under load.
- MCP progressive and graph publication/crash/retention/containment: 14/14.
- The focused negative matrix covers cache/DB/import/staging/manifest/graph and
  semantic-reader symlink redirection plus file, FIFO, socket, and staging-leaf
  special nodes with zero external mutation. It also covers missing/mismatched
  graph generations, a delayed contender beyond 1.1 seconds, eight simultaneous
  contenders, and crash-before-publication recovery.
- Scaffold migration and ownership: green in the full root suite.
- Source bindings: 14/14 and harness binding exact.
- Packed installed acceptance and published-artifact upgrade: passed.
- Full root: context 81/81 plus Node 386/386.
- Full package-owned MCP: 426/426.
- Frontend production build: 2,267 modules transformed; the existing large
  chunk warning remains informational.
- Dependency audits: root, frontend, MCP, scaffold parser, and root parser,
  all zero.
- Version sync: green at deliberately unchanged pre-bump metadata `2.4.2`.
- Syntax and `git diff --check`: green.
- Final Cortex changed refresh embedded 54 entities, reused 116, failed zero,
  and rebuilt the graph. Pattern evidence completed for all 21 indexed changed
  paths: 20 found local patterns and README used the repository fallback.
- Cortex doctor passes config, ingest, graph, embeddings, runtime-dist,
  runtime-dependency, and graph-load checks. Its only failure is the expected
  dirty-candidate freshness calculation (7/8 overall); the watcher is stopped.

## Exact Candidate Scope

The review candidate contains exactly these 52 paths:

- Release workflow/user docs: `.github/workflows/release-publish.yml`,
  `CHANGELOG.md`, `README.md`.
- CLI: `bin/cli/context-passthrough.mjs`, `bin/cli/help.mjs`,
  `bin/cli/scaffold.mjs`.
- Angular evidence code/config:
  `benchmark/bootstrapbench/config.angular-interactive.json`,
  `benchmark/bootstrapbench/wo046-progressive-angular.mjs`.
- Control docs: `docs/agent-control/acceptance-matrix.md`,
  `docs/agent-control/agent-work-orders.md`,
  `docs/agent-control/handoff-ledger.md`,
  `docs/agent-control/manager-log.md`,
  `docs/agent-control/risk-register.md`, packets 035/036, and WO-046/047
  result records.
- Package metadata: `package.json` only; version metadata is unchanged.
- MCP runtime/tests: `scaffold/mcp/src/embed.ts`, `embeddings.ts`, `graph.ts`,
  `loadGraph.ts`, `paths.ts`, `progressiveIndexing.ts`, plus
  `scaffold/mcp/tests/graph-bulk-load.test.mjs` and
  `progressive-indexing.test.mjs`.
- Ownership: `scaffold/ownership/v1.json`.
- Packaged scripts: `scaffold/scripts/bootstrap.sh`, `context.sh`, `embed.sh`,
  `ingest.sh`, `indexing.mjs`, `load-ryu.sh`, `status.sh`, `watch.sh`, and
  `scaffold/scripts/lib/ingest/pipeline-stages.mjs`.
- Development mirrors: `scripts/bootstrap.sh`, `context.sh`, `embed.sh`,
  `ingest.sh`, `indexing.mjs`, `load-ryu.sh`, `status.sh`, `watch.sh`.
- Root tests: `tests/bootstrapbench-progressive-indexing.test.mjs`,
  `cli-contract.test.mjs`, `packed-filesystem-containment.test.mjs`,
  `plugin-manifests.test.mjs`, `progressive-indexing-cli.test.mjs`,
  `scaffold-migration.test.mjs`, `scaffold-ownership.test.mjs`, and
  `session-bootstrap.test.mjs`.

## Handoff

Status: manager-accepted after Security/Contract, Code/Integration, and
Validation/Ops final re-reviews all returned GO without findings. The exact
candidate remains unstaged and uncommitted in this record; the separately
authorized PR/release sequence is next.
