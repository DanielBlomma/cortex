# WO-LOCAL-003 independent Ops/Validation/Integration review

Reviewer `/root/release_manager/ops_validation`, assigned before implementation.
2026-09-10; baseline `3c5d4da028f169255c14fb8230392c922cc5b12a`.
Isolated checkout `/private/tmp/cortex-ops-review.ixkzur/repo`; Git hooks disabled.
No implementation edits or publication. This is preliminary baseline evidence;
no candidate acceptance is implied. Logs are in the checkout's parent directory.

## Findings and required action

- **Blocker / validation:** workflows have removed the trusted dependency/build,
  root/runtime/bundle, fresh-checkout, audit, packed, and Harness gates. Restore
  necessary gates before tagging/publishing; preserve dual-package exact-artifact
  publication and resume semantics. Historical reference: `477f17e^` workflows.
- **Blocker / integration:** Release Bump fixes BASE_VERSION=2.6.0 and
  RELEASE_VERSION=2.7.0, and therefore cannot perform the authorized next minor.
  Derive strict next minor from checked main, preserving exact metadata staging,
  immutable tag rejection, annotated tags and atomic non-forced push.
- **Blocker / validation:** fresh six-lock audit finds frontend 1 high/1 moderate,
  MCP 5 high/6 moderate. Root, both parser locks, and bundle are clean. Fix bounded
  dependencies; do not waive the low-or-higher release audit.
- **Major / validation:** plugin-manifests mutation regression silently returns
  for every version other than 2.5.2 (line102), including current 2.7.0. Make lock,
  repository and identity negative tests run for current synchronized versions.
- **Major / validation:** fresh-checkout helper expects root 417 and MCP 426.
  Root candidate packet records 437. Reconcile exact observed totals after repairs;
  retain missing-summary/drift failure behavior and bounded output evidence.
- **Note / validation:** 30 extra top-level tests outside npm test and release/pack
  gates produce 307 tests:301 pass,6 fail,0 skip. All 6 failures require unavailable
  sibling `AgentStackBench/results/run_suites/wo045-frozen-inputs-v10c/packet-set-v10c.json`.
  They are 2 frozen replay tests in bootstrapbench-two-pass-subsystem and 4 in
  bootstrapbench-wo048-four-treatment. Record external fixture availability;
  do not describe a full inventory as green. No fixture redesign was attempted.

## Baseline classification

Focused `node --test tests/release-workflows.test.mjs tests/plugin-manifests.test.mjs
 tests/release-fresh-checkout.test.mjs tests/release-harness-identity.test.mjs`:
42 total, 31 pass, 10 fail, 1 skip. Linux identity/network-isolation test is skipped
on macOS. Ten failures match incoming report exactly.

Three plugin workflow assertions fail because install/build/root gate steps were
removed. Seven workflow failures include obsolete 2.5.2 metadata expectation,
missing pre-tag/fresh-checkout gates and insertion points, and stale prohibition
of legitimate bundle registry helpers. Missing safeguarded execution is real;
metadata literal and blanket helper prohibition are obsolete. Credential and
staging negative tests are masked by missing prerequisite steps and must be
re-exercised after restoration, not deleted.

## Required acceptance inventory

Install five committed dependency trees, build trusted MCP runtime, bind bundle
install to exact local root tarball, then focused release tests. Prepare isolated
root context and run full root/bundle tests; prepare isolated MCP context and run
MCP test:ci; execute the fresh-checkout regression in a clean disposable fixture.
Audit all six locks. Build frontend. Run packed containment, pinned Harness
contract, duplicate root/bundle artifact and integrity verification, empty-cache
install, and local packed Harness headless/Web lifecycle before tag/publication.
Publish requires exact annotated-tag/version identity, dual registry-state
integrity checks, root-first exact publication, bounded registry verification,
registry install and Harness lifecycle evidence. Preserve immutable safe resume,
OIDC provenance and complete metadata staging. CI is authoritative when present.

## External identities and host

Read-only npm latest root and bundle are 2.7.0; bundle pins root 2.7.0 exactly.
Root integrity `sha512-KDi++tLU16n3GpEfm76VICej2Ays+3cBrREKzO+bJmv4P3zJ3Uq3Fd+8KpDVpbfmH0iImjn/K2VVPcNhrZsCMw==`.
Bundle integrity `sha512-5y1+CQOwvEUc332rcv4MgITQUK4dNE5zokJd9RT86zxF/1GY5/gS5dI26OaLgWW43MHc6n5N0VUUHCnSZLpwHQ==`.
Remote v2.7.0 annotated tag 8ee0f5ed23b1410dfc35037e7ba452deced5d99e
peels to cd7e41469d208018554d878862119d4c443a512a; no v2.8.0 tag found.
Host macOS, Node 22.23.2, npm 10.9.8, .NET 8.0.422. No global tools modified.
Pinned Harness checkout b150a551b8d465e31e418e1b2eaf5e79bbb7d28e cloned
with hooks disabled; compatibility helper verifies 18 files. Actual lifecycle
validation remains a candidate gate.

## Cortex evidence

Read the four required Cortex skill files. Scoped ingest+graph only, no embeddings,
providers or hooks; tracked config restored. Search/rules/impact/related succeed.
Search evidence includes `file:.github/workflows/release-bump.yml`,
`file:tests/release-workflows.test.mjs`, and
`chunk:tests/release-workflows.test.mjs:validateBumpWorkflow:153-197`.
Six active rules. Pattern evidence succeeds for both workflows and both release
manifest/workflow tests. `scripts/release-fresh-checkout.mjs` pattern evidence
fails verbatim: `INVALID_ARGS: aliases is not iterable`; tooling limitation is
recorded without converting it to policy pass/fail. Candidate review pending.

## Runtime baseline clarification

Trusted runtime build and MCP context prep succeeded. Full MCP test:ci observed
651 total / 646 pass / 5 fail / 0 skip. All 5 query-cli failures followed absent
`bin/cli/query-command.mjs` in reviewer-scoped root context (pattern/conventions
lookup, then missing conventions manifest for guidance/review). This exact file
is a direct test prerequisite per query-cli.test.mjs:115,159,182-280; add it to
scoped source paths. The conventions test persists the manifest before later tests.
A subsequent default root-context command was stopped during filesystem copying,
before ingest, to preserve the packet's narrow indexing boundary. No broad ingest
or provider execution occurred. Candidate rerun remains necessary.

## First candidate review: 2eb9190359a31a7db3237c00c48b185d840cf280

Independently fetched immutable owner commit into reviewer checkout. Candidate
MCP `npm ci --prefix scaffold/mcp --no-fund` and build pass with the new lock;
install reports 3 moderate vulnerabilities. This is a blocked-PR review only.

Source review confirms restored pre-tag/prepublish tests, audits, frontend build,
packed containment, local install and Harness gates; publication now uses the
artifacts that passed local gates and verifies equality against seed integrities.
Version guards are updated explicitly 2.7.0→2.8.0 (one-shot next release, not an
indefinitely reusable bump). Negative manifest identity checks no longer return
without assertions. Exact fresh-checkout totals now 437 root and 651 MCP, with
negative old-count regressions preserved.

Additional findings sent to owner:

- **Blocker / validation:** standard MCP test context preparation leaves
  `scaffold/.context/mcp/` and `scaffold/.context/scripts/` unignored in Git.
  `query-cli.test.mjs` review--diff then fails with
  `Review changed path count exceeds the version-1 limit`. Adding its exact
  indexed CLI target resolves 4 earlier failures, leaving this one. Fix generated
  runtime isolation or ignore paths without weakening review bounds; private
  reviewer excludes will not be used to claim the standard gate passed.
- **Major / validation:** publish has only a root registry clean-install smoke.
  Existing dual-package install-registry and harness-registry helpers should
  verify the actual registry-installed bundle and Harness after both exact
  registry verifications. Local packed Harness alone tests local tarballs.
  Owner must fix or explicitly carry this as unfinished readiness in blocked PR.

## Final blocked-PR disposition: 31fc32e47f0a5e42d4dd08cdd150f803335e1719

**GO to publish/update the reviewable blocked draft PR. NO merge or release
acceptance.** No audit waiver is granted. This final section supersedes the
preliminary open Ops findings above.

The owner fixed generated runtime isolation using exactly
`scaffold/.context/mcp/` and `scaffold/.context/scripts/` ignore entries. New
postpublication gates run both registry package installation and pinned Harness
registry headless/Web lifecycle after exact root/bundle registry verification
and before final summary. Negative tests reject missing helper invocation and
premature ordering. Both independently raised Ops findings are closed.

Independent exact-head validation:

| Gate | Result |
| --- | --- |
| New MCP lock clean install + TypeScript build | PASS (dependencies unchanged between 2eb9190 and 31fc32e) |
| Full MCP test:ci |651/651 PASS,0 fail,0 skip,38.900 seconds |
| Focused release contracts |42 total,41 pass,0 fail,1 Linux-only skip,8.137 seconds |
| Release metadata synchronization |PASS,current 2.7.0 |
| Six-lock audits |Root,frontend,both parser trees,bundle all clean; MCP 3 moderate,0 high |
| Pinned Harness source compatibility |18 files verified at b150a551b8d465e31e418e1b2eaf5e79bbb7d28e; unchanged candidate inputs |

Full MCP ran on independently installed candidate locked dependencies. Its root
context remained restricted to direct release sources plus the exact
`bin/cli/query-command.mjs` test prerequisite. No provider, embedding, broad
indexing, background hook, global tool installation, or source implementation
mutation occurred in this reviewer checkout.

The remaining blocking audit is the adm-zip advisory and transitive
onnxruntime-node/transformers chain (3 moderate). The required audit correctly
exits 1. Earlier frontend/MCP high findings are resolved by the candidate locks.
Root full tests, frontend build and packed containment are manager-owned final
runs; this reviewer does not relabel their evidence as independently executed.
Actual fresh-checkout end-to-end, final local/registry Harness lifecycle and
Linux-only identity smoke remain explicit release/CI gates, not claimed passes
from static workflow review. Extra benchmark fixture absence remains as recorded.
The current next-minor workflow is deliberately explicit 2.7.0→2.8.0 and would
need another reviewed target update for a later release.

Final Cortex fallback review refreshed only the 15 listed direct sources and ran
rules plus per-file pattern evidence. Six active rules returned. Evidence succeeds
for both workflows, plugin/workflow tests, MCP package manifest and both changed
locks. `.gitignore` is not supported by this index (`Pattern target was not found
in indexed context: .gitignore`). Fresh-checkout helper and test return
`INVALID_ARGS: aliases is not iterable`. Those exact advisory-tool limitations
are preserved; direct source/diff inspection and executable negative tests provide
review evidence, without asserting a nonexistent Cortex policy verdict. Final
source hashes are recorded in `../final-source-hashes.txt` relative to checkout.
