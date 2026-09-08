# Reliability baseline reconciliation — WO-RV-001

Observed 2026-09-08. Former branch-local plan alias: WO-050. Accepted locally
after independent review; acceptance is docs-only, not runtime readiness. Owner `/root/wo050_owner`;
Code Quality + Security/Privacy `/root/wo050_review`; Validation `/root`, assigned
before implementation in packet rv-001 and the handoff ledger.

PR integration note (2026-09-08): this report preserves observations from the
original reconciliation. Absolute local paths and worktree statuses below are
historical evidence, not setup prerequisites or current execution directions.
The published packet is named `rv-001-baseline-reconciliation.md` (originally
`038-reliability-baseline-reconciliation.md`). Use the checked-out PR/main
documents and a new isolated worktree for subsequent implementation; preserve
the newer main control history. This docs-only PR does not reopen historical
acceptances, launch future work, merge, or publish a runtime release.

## Baseline decision

The earlier assessment measured an old, dirty checkout, not current main.
The live checkout `/Users/danielnilsson/GIT/cortex` is on
`plan/r16-ingest-filesystem-containment` at
`9f403762f373b379eb2597c7598c4848508b717f`, package 2.4.2. Fetched `origin/main`
is `b7d466fa474dfa97fb77a931a674080801e6fa77`, package 2.7.0, 123 commits ahead.
The manager selected that exact main commit for future implementation.
The next worktree is `/private/tmp/cortex-rv-main.i2t4IG/repo`, branch
`plan/rv-reliability-main`: clean when created, now containing only three known
untracked rv-002/003/004 packet files. Recheck identity and dirty state before work.
The reconciliation worktree is `/private/tmp/cortex-wo050.YaeMq8/repo`.

Do not merge, reset, upgrade, or rebuild the old checkout to manufacture a clean
baseline. Its changes remain user-owned evidence. Main already contains the
reviewed containment fixes, progressive indexing, released DeepSeek Harness
integration, dialect work, and maintained-analysis/provisioning capabilities.
Main's manager log records both root and Harness 2.7.0 publication; its later
feature acceptance and release restrictions remain authoritative. The old
WO-049 “planned/paused” statement applies only to that branch's plan lineage.

Main has independently allocated WO-050 through WO-063. The new program uses
qualified work-order IDs to avoid those collisions and also isolates its new
requirement/risk IDs so they cannot be confused with later main registries:

| Original plan alias | Current ID | Scope |
|---|---|---|
| WO-050 | WO-RV-001 | This reconciliation |
| WO-051 | WO-RV-002 | Freshness |
| WO-052 | WO-RV-003 | Dependencies |
| WO-053 | WO-RV-004 | PR checks/test inventory |
| WO-054 | WO-RV-005 | Graph uncertainty |
| WO-055 | WO-RV-006 | Default-model resources |
| WO-056 | WO-RV-007 | Offline evaluation contract |
| WO-057 | WO-RV-008 | Separately authorized evaluation |
| REQ-20/21/22 | REQ-RV-1/2/3 | Operation, context, agent value |
| R22/R23/R24/R25 | R-RV-1/2/3/4 | Freshness, provenance/CI, graph claims, evaluation |

Historical IDs elsewhere retain their dated branch-local meanings. This mapping
does not rename any main work order or authorize its deferred work.

## Old checkout and runtime identity

[All-path inventory](wo-rv-001-dirty-inventory.json) records every modified tracked
path and every individual nonignored untracked file: 49 + 44 = 93. The earlier
49 + 42 count predates the planning turn's two new files (the program plan and
packet rv-001); execution starts at 49 + 44. No tracked deletion or rename was observed. Every row has
size, SHA-256, working/HEAD/main/historical Git blob identities, proposed scope,
uncertainty, and preservation disposition. Twenty current files equal main;
28 equal historical `c2d4531`. Equality establishes bytes, not authorship or
permission to sweep those changes into a commit.

`/opt/homebrew/bin/cortex` resolves to
`/opt/homebrew/lib/node_modules/@danielblomma/cortex-mcp/bin/cortex.mjs` and reports
2.4.1; executable SHA-256 is
`e40e870a94fb78c818b98c8dc6245988542aed4efa91112c34e0463b3cdf7619`.
CLI `bin/cli/project-runtime.mjs` resolves project queries to `.context/mcp/dist`;
the installed CLI version is not the project runtime identity.
The old `.context/mcp/package.json` reports private `cortex-mcp` 0.1.0, SHA-256
`56aa076c7250663f4e8a2af6ff264ba72ead5bbb8e3ee689dfc5cf5e93c691a7`.
That generic version alone cannot establish source/build equality with either
2.4.2 or 2.7.0. No runtime synchronization was attempted. A recursive read-only
inventory of `.context/mcp/dist` found 115 regular files; SHA-256 of JSON-encoded
`[relative-path, file-SHA256]` pairs sorted with `localeCompare(..., "en")` is
`c5cdb0d122cfeb6ed5facf6f92f557bcd39ad92f2373a479d01053225fd9ae6b`.
The actually resolved `dist/cli/query.js` SHA-256 is
`80abae17b97f71af82c2b8abd0765e2fe4306db04e7a3ecf5508257816f1ed08`.
These fingerprints identify the observed build without asserting its provenance.
Read-only `cortex watch status` reported stopped.

| Old project manifest | Generated at | State |
|---|---|---|
| `.context/cache/manifest.json` | 2026-08-30T09:54:19.651Z | changed; scope `.`; 686 files, 3,505 chunks; 90 changed candidates |
| `.context/cache/graph-manifest.json` | 2026-08-28T05:30:15.790Z | 686 files, 3,505 chunks; unversioned graph path |
| `.context/embeddings/manifest.json` | 2026-08-19T11:29:06.577Z | Jina base-code, 768 dimensions; 4,193 output/entities, 635 embedded, 3,558 reused, 0 failed |

Manifest SHA-256 values respectively:
`bf7327c95ef02f5ff86b685541c0b0493296b80f4dd6f7d83e6ced29ee60df80`,
`1091486311739496ef9339fc3ce6fec1d7300f91947946b84350ebac1a6a332b`,
`96e67a1495a972db6ed60d2a7399acaa50e50677b4820a660dc9be48d4df8d83`.
These legacy manifests have no shared generation identity. They are mixed-age
observations, not proof of content freshness; matching counts do not bind bytes.
Cortex search and rules succeeded against this old index; direct files resolved
the discrepancy. No index rebuild, lifecycle change, provider call, or publication
is part of this work. Doctor/status were inspected as source because executing
status can write version caches and executing doctor can probe configured services.

## Existing edits and integration order

The JSON distinguishes scope inference from exact historical byte matches.
WO-034 candidates cover filesystem boundary, cache I/O, dashboards and tests;
WO-036..045 candidates cover retrieval/search and benchmark evidence; WO-046
covers progressive lifecycle, embedding/graph publication, mirrored scripts and
scaffold fixtures; WO-049 owns the old Harness plan. Shared pipeline, package,
ownership and control files span several work orders. Root Git-ignore discovery,
local config, the differently named packet 036, and mixed README hunks have
unknown or incompletely established ownership. Preserve them all.

1. Accept only this additive reconciliation after independent review; preserve
   copied prestate `/private/tmp/cortex-wo050.YaeMq8/wo050-docs-prestate`.
2. Start the new program from pinned main in its separate worktree. Its runtime
   is unchanged; three known packet files are present. Carry
   this report/qualified plan/next packets, not the old runtime or wholesale old
   manager/risk/work-order tables over main's newer registry.
3. Any later salvage of unmatched old edits needs a path/hunk comparison and
   named owner. Byte equality already on main needs no reimplementation.
4. WO-RV-003 owns dependency manifests/locks before WO-RV-004 changes shared
   package scripts. WO-RV-002 may work independently only with recorded disjoint
   files; final CI acceptance follows dependency remediation.

## Recovered experiment evidence and current states

Local Git history contains all three requested missing files at
`c2d4531b903157ac5ff8ce88bfed69624cc30659` (2026-08-22). These exact historical
bytes are restored under `recovered/c2d4531/`, preserving the unrelated packet036.
Their internal root-relative/backtick references describe the historical tree;
they are archival evidence, not executable fresh-session instructions. Resolve
any referenced historical-only source with `git show c2d4531:<path>`.

| Recovered artifact | SHA-256 |
|---|---|
| [WO-047 packet](recovered/c2d4531/036-two-pass-subsystem-retrieval.md) | `0c95aed68c14dbbfaef87f2873923269906a0a45dc6a5dbb494205d381b5da6d` |
| [WO-047 result](recovered/c2d4531/wo047-quick-five-treatment-results.md) | `7e5729f83e24ae9f25d77bf8b70bb6a42d5d8df7a2143b788d41851ed6a82c9e` |
| [WO-048 result](recovered/c2d4531/wo048-quick-four-treatment-results.md) | `2f21afd2a94e5769122ac695932a55cc96ea55f694a00e27bf22896080b6a4c7` |

Validation compared all three copies byte-for-byte with Git. The independent
reviewer also verified all nine saved patch SHA-256 values against the reports
under ignored `benchmark/bootstrapbench/results/wo047-quick-five-treatment-v1/`
and `wo048-quick-four-treatment-v1/`. The directly referenced Stage 1 roots
`wo047-two-pass-stage1/` and `wo048-four-treatment-v1/` exist. Private raw outputs
and credentials were not copied. Mechanism judgments and historical test results
are recovered reports, not rerun/rejudged results in this work order.

WO-045 V10y remains terminal NO-GO at 2026-08-22T05:29:06Z: both arms had 12
nonconvertible records, zero predictions and zero new provider calls. Historical
aggregate calls were 2/26 from discarded V9. Its old 24-call approval grants no
new launch authority. WO-047 Stage 1's 7/10 retrieval result was accepted offline;
its subsequently authorized treatment-only smoke scored 2/5 and failed the 4/5
mechanism gate. WO-048 treatment-only smoke reported 4/4, with VS Code and Django
repository suites unavailable. Neither smoke includes an issue-only control;
neither establishes retrieval uplift. Future evaluation requires WO-RV-007's
frozen proposal and fresh explicit model/run/cost authorization for WO-RV-008.

## Containment reconciliation

Historical WO-034 acceptance exists at `667aa5f3d61bb0c968c37ddef73409295e7556d3`;
WO-035's baseline was introduced at `e86ce65`. Read their exact files with
`git show b7d466f:docs/agent-control/wo-034-output-cache-dashboard-data-containment-baseline.md`
and `git show b7d466f:docs/agent-control/wo-035-integrated-filesystem-containment-acceptance-baseline.md`.
The latter records independent GO, R16 mitigated, 41/41 packed boundary tests,
416-entry equal marker-present/absent inventory, actual installed dashboard
rendering, released-tag upgrade, frozen bytes/traces, all-tree audits, suites,
and review closure. These are historical acceptance facts, not new test results.

The old dirty candidate is earlier than those accepted review fixes. Direct
comparison of boundary/pipeline/I/O, both dashboards and boundary tests differs
from accepted WO-034. In particular old staging cleanup removes paths without
the accepted inode-ownership/relocated-parent validation, whole-set precommit
validation is missing, and dashboard npm fallback lacks policy-error rethrow.
Thus source presence does not complete/review that candidate. Do not close the
old branch's R16 or carry its candidate over main. Main already has the reviewed
fixes; this work neither reopens main's historical R16 disposition nor issues a
new mitigation claim based on inspection.

If anyone elects to revive that old candidate, WO-034 needs those fixes plus
independent Code Quality/Contract/Security/Integration/Validation closure; WO-035
then needs the real packed containment harness, exact inventory/ownership and
marker parity, installed dashboard tests, released-tag force upgrade, complete
source/output/symlink/special/hard-link/fault/cleanup/no-npm matrix, frozen
full/changed bytes/traces/worker parity, clean installs/native smokes, root/MCP
suites, all current audits, version checks and Ops/Release review. None was run
for the old dirty tree here. The selected main baseline avoids that duplicate
implementation; future runtime/package changes still run its packed gate.

## Main-specific remaining work and validation

Freshness remains a real source-backed issue on pinned main: doctor's scope
match treats `.` literally and catches Git failure as zero changes; status
normalizes `.` but still equates worktree dirtiness with index freshness. Reuse
main's progressive generation and maintained-analysis trust boundaries rather
than creating a second state authority. See [freshness packet](context-packets/rv-002-freshness.md).

Validation freshly audited exported pinned-main manifests/locks on 2026-09-08
using `npm audit --package-lock-only --audit-level=low --json --prefix <tree>`:
root 0; frontend 1 high (`browserslist`); runtime 2 high + 1 moderate
(`ajv`, `fast-uri`, `qs`); both parser trees 0; Harness bundle 0. Frontend/runtime
exited 1. Exported evidence: `/private/tmp/cortex-main-audit.Gs13Lu`.
These advisory observations supersede the old-branch counts for future work;
they are not install/native compatibility checks. See [dependency packet](context-packets/rv-003-dependencies.md).

Main still lacks ordinary PR core workflow triggers. Validation ran
`node --test --test-reporter=spec tests/release-workflows.test.mjs` in the clean
main worktree: 13 tests, 6 passed, 7 failed (including stale 2.5.2 expectation,
missing old step names, and old bundle registry-helper prohibition). Main's log
reports ten broader historical release-contract failures; do not conflate that
count with this selected-file rerun. Preserve security invariants while
reconciling tests with the actual release contract. See [PR checks packet](context-packets/rv-004-pr-checks.md).
No old-branch suite total establishes main readiness. Each next work order must
record its exact source, commands, failures/skips and independent reviews.

## Checks and acceptance

Fifteen paths differ from the preserved control prestate, including the three
packets authored in the separate main worktree and copied in by the manager.
All 66 relative Markdown links in changed active docs resolve locally; recovered
historical bytes are deliberately excluded from active-link rewriting. The
inventory parses as JSON and enumerates exactly 93 unique existing paths.
`git diff --check` passes. Runtime suites were not rerun for docs-only changes;
the separate main audit/release-test observations above are scoped explicitly.
Independent Code Quality + Security/Privacy reviewer `/root/wo050_review`
returned GO after closure of two minor findings: scaffold ownership/upgrade
coverage in rv-002 and mixed work-order aliases. Validation `/root` verified
all 15 reviewed file hashes, all 93 original dirty-path hashes, and the three
recovered files against their historical Git bytes. Manager accepts WO-RV-001
locally, documentation only. Acceptance-status edits follow the reviewed
substantive snapshot; no runtime gate, release, or provider run is accepted.

Fresh-session continuation: start only from the next bounded packet
[WO-RV-002](context-packets/rv-002-freshness.md), rechecking pinned main and
worktree status. The Context Window Rules require a new manager session at
this safe handoff; do not carry this reconciliation conversation into another
work order. Preserve main's newer control history rather than overlaying this
old branch's control tables.
