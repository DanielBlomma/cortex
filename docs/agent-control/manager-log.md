# Manager Log

Durable chronological log for scope, decisions, approvals, blockers, and
staging status. Do not rely on chat memory for acceptance or merge decisions.

Rotation rule: at each day rollover (or at ~150 lines), move the previous
day's entries to `archive/manager-log-YYYY-MM-DD.md` and refresh Current State.

## 2026-08-27 — WO-051B runtime-contract prerequisite planned

- The user authorized auto-advance. Cortex rules/search/impact and three
  read-only scope audits checked the accepted WO-051 head before WO-052/053
  assignment.
- Direct parallel start is blocked: the accepted dialect contract is
  benchmark-only and excluded from the npm package, while parser modules are
  packaged managed scaffold sources. Copying validators would create two
  authorities; importing benchmark code would break installed parsers.
- Adding a neutral runtime authority also adds one managed scaffold target.
  Packet 054 explicitly requires package/ownership expansion to become a
  separate packet. Packet 055 therefore defines WO-051B before any parser code.
- WO-051B owns only the neutral runtime contract, benchmark re-export,
  ownership v2/current pointer, and narrow contract/ownership/packed tests. It
  freezes canonical observation order and an exact opt-in in-memory composite
  transport while preserving existing `{chunks, errors}` and the accepted
  manifest/limits hashes.
- Ownership v1 remains byte-identical. Registry, parser composition, worker,
  pipeline, persistence, parser selection, dependencies, versions, and public
  CLI/MCP are excluded. WO-054 retains sole ownership of integration.
- After WO-051B full-panel acceptance, WO-052 owns Acorn/Tree-sitter/C/C++/Rust
  parser seams and WO-053 owns C#/VB.NET/Roslyn/VB6/SQL seams. Their parser and
  test scopes are disjoint and may run in parallel from the accepted
  prerequisite head.
- WO-052 and WO-053 remain blocked until WO-051B is independently accepted.

## 2026-08-26 — all-language parser-backed codebase-dialect program planned

- User intent is now explicit: codebase dialect means the recurring, locally
  evidenced structural and implementation patterns that show how a codebase
  normally solves a particular kind of problem. Coding style and broad
  architecture are adjacent but are not the primary target.
- Packet 054 covers all 14 current programming-language families using their
  existing Acorn, Tree-sitter, Roslyn, dispatcher/fallback, SQL, and VB6 parser
  paths. The shared observation contract lives at the parser-result boundary;
  no language is reparsed through a second parser.
- WO-051 freezes the contract and harness, WO-052/053 implement disjoint parser
  families, WO-054 adds persistence and task-conditioned comparison, and WO-055
  runs the blind all-language evaluation.
- Program acceptance requires 14/14 available language outputs, at least 14
  fresh tasks and 56 facets, strict recall/citation gates, a minimum 0.30 lift
  over baseline, deterministic local-only output, and no reuse of prior WO-D
  tasks.
- Public generation/review integration, parser migration, new-language support,
  legacy scaffold migration, release, and promotion are explicitly deferred.
- Planning is isolated at accepted WO-C base `e74e03f` in
  `/Users/danielnilsson/GIT/cortex-wo051-dialect-poc`. The dirty discarded WO-D
  worktree is not an input and may be removed only through a separate explicit
  worktree/branch cleanup after this plan is durably retained.
- The user accepted the staged program and authorized execution on 2026-08-26.
  WO-051 must now start in a fresh agent session from packet 054; WO-052 and
  WO-053 remain blocked until its contract and harness are independently
  accepted.
- The clean planning worktree's generated Cortex scaffold is older than the
  installed CLI and was deliberately not auto-migrated. Cortex rules/search use
  the already functioning local runtime in `/Users/danielnilsson/GIT/cortex`
  until a separately authorized scaffold migration exists; product and plan
  diffs stay isolated in the clean worktree.
- The accepted plan is committed as `d8689c8`. Read-only verification showed
  the obsolete `feature/wo-d-held-out-evaluation-2.5.2` branch had zero commits
  relative to base and its worktree contained only the recorded uncommitted
  experiments. The exact worktree and branch were then removed; the healthy
  `/Users/danielnilsson/GIT/cortex` runtime remains available for mandatory
  Cortex context.
- WO-051 now runs in `/Users/danielnilsson/GIT/cortex-wo051-contract` on
  `feature/wo051-dialect-contract`, owned by a fresh agent session with packet
  054 and its direct references only. No parser implementation stage is yet
  authorized.

## 2026-08-26 — WO-051 round-1 review NO-GO

- The four-file candidate changed only new benchmark contract/harness modules
  and focused tests. Nominal dialect tests passed 14/14; SQL/VB6 and Roslyn
  proportional regressions also passed.
- Three independent fresh reviews returned NO-GO. Adversarial runs proved the
  score gate could pass with candidate recurrence and scope precision at zero,
  and with every baseline facet contradicted. Gold could omit applicable
  categories; failure fixtures could use the wrong status; the manifest
  validator accepted a fabricated family/mode; and rehashed earlier artifacts
  were not compared with an evaluator-retained predecessor hash.
- Additional bounded findings cover exact clang/regex fallback identities,
  frozen source-catalog citation binding, deterministic claim-id ordering,
  task-local reveal facets, and pre-canonicalization caps. These are WO-051
  contract/harness fixes, not authorization for parser behavior or WO-052.
- The implementation owner received one consolidated fix assignment in the
  same four-file boundary. WO-052 and WO-053 remain blocked until re-review and
  manager acceptance.

## 2026-08-26 — WO-051 accepted locally

- The accepted implementation is commit `2508c20` and contains exactly four
  new files: two benchmark-owned contract/harness modules and two focused test
  files. No parser, ingest, scaffold source, dependency, CLI/MCP, version, or
  public product contract changed.
- Review fixes close every round-1 and re-review finding: exact 14-family and
  29-mode identities with clang/regex fallbacks; exact golden failure and
  oversized/truncation semantics; 68-facet full applicable-category gold;
  source-catalog path/hash/line binding; symmetric valid-audit explicit credit;
  citation/recurrence/scope precision and contradiction gates; evaluator-held
  predecessor hashes; deterministic task-local claim/reveal relations; and
  cumulative input/task/artifact caps.
- Stable symlink/hard-link layouts fail closed. The contract explicitly records
  the local trust residual for offline whole-chain rewrite and a privileged
  concurrent same-user run-root/parent race; no network, model, provider,
  planner, telemetry, subprocess, or worker path is added.
- Manager reruns pass focused 21/21 and proportional dialect plus SQL/VB6/C#/
  VB.NET 61/61, module syntax, and diff checks. Three final independent
  Parser/Contract, Security/Containment, and Validation/Evaluation re-reviews
  return GO with zero blocker, major, or minor findings.
- Cortex search/rules/impact used the healthy primary runtime. Pattern-evidence
  cannot resolve files newly created only in a separate worktree without an
  unauthorized scaffold/index migration; that limitation is recorded rather
  than bypassed. WO-052 and WO-053 may now receive dedicated packets and fresh
  parallel sessions; WO-054 remains blocked on both.

## Current State (2026-08-26)

- WO-C deterministic local diff review is manager-accepted on accepted base
  `482f196`. The same single reviewer returned final GO after packet-053
  narrow verification. The exact candidate is 25 paths: 22 covered outputs plus
  governing packets 051–053. `cortex review --diff` has strict root/runtime routing,
  complete replayed Git-transaction binding, exact local profile mapping, deterministic and
  heuristic separation, explicit conflict suppression, concrete live-backed
  evidence, closed hashes/counts/limits, and bounded JSON/text. Full technical,
  managed lifecycle, accepted-base compatibility, expanded-pattern/restored-
  normal, backing, doctor, watch-stopped, and repeated state-neutral evidence
  is recorded in `docs/agent-control/wo-c-diff-review-2.5.2-results.md`.
  Version/dependencies remain unchanged and no commit or release action
  occurred. WO-D is unblocked but not started and requires a fresh work order.
- WO-B is manager-accepted locally on the accepted WO-A 2.5.2 base. The
  stable evidence locator is
  `docs/agent-control/wo-b-pre-coding-guidance-2.5.2-results.md`; packet 050
  captures the single terminal NO-GO. The exact candidate is 25 paths: 21
  covered outputs plus governing packets 047–050. Public raw-task/allowlist
  recomputation is closed; convention source/tests/public bytes are restored
  exactly to `d326227`; guidance alone derives real caller/test relation
  provenance and reusable identity. Search/related/impact, accepted
  conventions, and two-pass public behavior remain unchanged.
  Build/focused/full/root/frontend/audit/version/packed/base-byte/managed
  lifecycle gates are green. Final expanded-pattern/restored-normal evidence
  is recorded in the results file. Version/dependencies remain unchanged; no
  commit or release action occurred. WO-C is unblocked but has not started;
  it requires a separate fresh work order.
- WO-A is manager-accepted locally on Cortex 2.5.2. The owner completed packets
  045–046; Code Quality, Contract, Security/Privacy, Integration, and
  Validation all returned final PASS with no remaining blocker, major, minor,
  or note finding. The final Validation follow-up independently proved the
  durable pattern loop fails closed on an intermediate error and validates
  exactly 26 successful JSON artifacts.
- The stable evidence locator is
  `docs/agent-control/wo-a-repo-local-conventions-2.5.2-results.md`: 28 changed
  paths (20 modified, 8 added), 26 covered outputs plus two governing packets,
  exact gates/hashes/reproduction commands, 151/151 normal-index checksums,
  12 validated profiles, doctor 8/8, watcher stopped, and clean diff checks.
  Version remains 2.5.2 and dependencies remain unchanged. WO-B was not
  started; it may begin only as a separate fresh work order from this accepted
  2.5.2 state.

- Released npm baseline is `v2.4.2`. The annotated tag peels to corrected
  `origin/main` at `736becf34d929ea0bef88adbe476a584a1f081e9`,
  and Release Publish run `30523845440` completed successfully.
- WO-026 through WO-031 are accepted, merged, and released. The final
  integrated record is
  `docs/agent-control/wo-031-integrated-validation-baseline.md`.
- WO-031 preserved the frozen CLI, Enterprise, ingest, deterministic, package,
  upgrade, and memory contracts. Syntax, focused tests, context regressions,
  full root/MCP suites, five dependency audits, extracted-package smokes, and
  all six reviewer roles are green.
- Final memory medians are 631.46 MB for Cortex (+2.79% versus WO-026) and
  1,016.16 MB for Angular (-1.75%), inside the five-percent acceptance band.
- The accepted worktree `2.4.2` tarball contains 417 entries, all 19 CLI
  modules, all 15 canonical ingest modules, and all three ownership files. A
  clean-prefix install reports `2.4.2`. The clean release checkout correctly
  produces 416 entries because the intentionally unowned stale
  `scaffold/mcp/dist/embeddingModel.js` is absent.
- Release review fixed MCP registry Node-floor drift and added the registry
  submission to release-version synchronization and Release Bump staging. All
  six reviewers then closed with no blocker, major, or minor findings.
- Initial Release Publish run `30521392683` stopped safely before npm. PR #110
  fixed both release workflows to install/build `scaffold/mcp` before root
  tests and added ordering regressions. After reviewer acceptance and merge,
  the unpublished tag was deliberately moved from `bd968d4` to corrected
  `736becf`; run `30523845440` passed every gate and published npm `2.4.2`.
- R14 and R15 are mitigated locally. WO-032 through WO-035 are manager-accepted
  and R16 is mitigated after clean packed-artifact acceptance. WO-030's narrow
  same-user ancestor-swap assumption and WO-034's possible deterministic
  commit prefix remain documented residuals.
- The modularization program and release recovery are complete. WO-032 through
  WO-035 are accepted locally. WO-035's dependency blocker and first-review
  packed-dashboard, inventory, released-upgrade, Work Profile, and release-gate
  findings are fixed; all three independent re-reviews are GO.
- WO-046 is accepted locally as a progressive-indexing prototype. WO-047
  integrates it into the 2.5.0 candidate; all round-1 and round-2 NO-GO
  findings are fixed, all three final re-reviews are GO, and the manager has
  accepted the candidate for the authorized PR/release sequence.

## Open Decisions

- Whether `cortex mcp` is deprecated for one release or removed directly in a
  future breaking release.
- Whether `@danielblomma/cortex-mcp` is retained as the npm package name during
  the CLI-first migration or followed by a new package with a migration
  window.
- Whether the merged `2.5.0` Release Bump and tag-gated Publish workflows pass
  on GitHub and npm `latest` resolves to the verified final artifact.

## Closed Decisions

- The behavior-preserving CLI/ingest modularization program is accepted locally
  through WO-031.
- Patch release metadata may move to `2.4.2`; technical acceptance and six-role
  review completed before the bump.
- Under explicit user instruction, PRs #109 and #110 were merged, the failed
  unpublished tag was replaced with corrected `main`, and npm `2.4.2` was
  published only after the fixed release gates passed.
- R16 remediation is sequenced as WO-032 characterization/contract, WO-033
  source/control containment, WO-034 output containment/cleanup, and WO-035
  integrated package acceptance. External source roots are not authorized;
  portable relative roots only, with explicit symlink denial.
- WO-032's reviewed contract is accepted. Its safe-alias normalization is an
  intentional changed-mode correctness fix, repository identities use a
  separate host-valid grammar, and trusted parser toolchain/network behavior
  remains outside R16's ingest-managed data boundary.
- WO-033's reviewed source/control containment is accepted. Output,
  prior-cache, cleanup, and dashboard-data containment remain exclusively in
  WO-034; packed-artifact acceptance and R16 disposition remain in WO-035.
- WO-035 is accepted after all first-review findings were fixed and all three
  independent re-reviews returned GO. R3 and R16 are mitigated without waiver;
  semver minor `2.5.0` is accepted for the later authorized release sequence.
- WO-B pre-coding guidance is accepted locally on Cortex 2.5.2 after terminal
  remediation and the single independent final reviewer returned GO. WO-C is
  unblocked but remains a separate, not-started work order.

## 2026-08-25 — WO-C owner completion

- Implemented the packet-051 deterministic local-only post-coding review
  contract without changing accepted conventions, guidance, retrieval,
  two-pass, Enterprise, policy, version, or dependency behavior.
- The frozen scope is 22 output paths plus packet 051. Production-boundary
  tests cover exact/near/over input and retained-item caps, real Git state and
  filesystem negatives, authority/conflict classification, schema/backing
  tampering, runtime preflight, sanitization, and state neutrality.
- Full MCP, context, root, frontend, five-audit, version, packed, managed
  init/bootstrap/update/watch, installed-runtime, accepted-base byte-parity,
  pattern, manifest/backing, doctor, watch-stopped, syntax, and diff evidence
  is durable in the WO-C results file. Owner disposition is ready for exactly
  one fresh independent comprehensive read-only review; only the manager may
  accept WO-C or unblock WO-D.

## 2026-08-25 — WO-C final-review remediation owner completion

- Packet 052 was created before code edits and closes the exact five majors
  from the single comprehensive review: complete linked-worktree-aware Git
  transaction replay, exact locality and authority applicability, selected
  canonical profile/live-backing rechecks even with zero results, recursively
  strict canonical schema invariants, and literal placeholder-free evidence.
- Focused review is 28/28, full MCP is 586/586, context regressions are 81/81,
  root Node is 394/394, frontend transforms 2,267 modules, five audits are
  zero, version remains 2.5.2, and packed containment remains 430 entries at
  409/21 with inventory `0dd5599b…1795`.
- The exact 24-path candidate is frozen for the same single reviewer's narrow
  read-only delta verification only. No acceptance, commit, push, merge,
  release, dependency/version change, WO-D, or extra broad review occurred.

## 2026-08-25 — WO-C canonical chunk-backing remediation

- Packet 053 was created before edits. Every selected profile's non-window
  chunks are now freshly reconstructed from exact live or HEAD-backed bytes
  through the shared ingest parser registry and canonical persistence helpers.
  ID-preserving body, signature, kind, or description fabrication fails closed
  even for profile-only zero-result review; all semantics and the Git/context
  transaction are replayed again immediately before output.
- Build and focused review pass 29/29; the proportional MCP gate passes
  587/587, including the live checkout. The final candidate is 25 paths: 22
  covered outputs plus packets 051–053. It is frozen for only the same
  reviewer's narrow two-major verification; acceptance and WO-D remain blocked.

## 2026-08-25 — WO-C accepted locally

- The same single independent reviewer returned final GO/PASS after packet 053.
  Canonical shared-parser reconstruction binds every selected profile chunk to
  exact live/HEAD-backed source bytes and rechecks all output-affecting fields
  immediately before output, including zero-finding paths.
- Manager acceptance covers exactly 25 paths: 17 modified and 8 added, with 22
  covered outputs plus packets 051–053. Definitive evidence is focused 32/32,
  MCP 587/587, context 81/81, root 394/394, frontend 2,267, five zero audits,
  packed 430 at 409/21, expanded pattern 22/22, restored normal 162 documents
  and 12 profiles, six accepted-base byte comparisons, exact 18-state
  neutrality, doctor 8/8, watcher stopped, and clean diff checks.
- WO-C is accepted locally. No push, merge, release, publish, version or
  dependency change occurred. WO-D is unblocked but remains not started and
  requires a separate fresh work order.

## 2026-08-25 — WO-B owner completion

- Implemented the packet-047 versioned guidance contract as CLI-first
  inspection only. Guidance validates target and Unicode-scalar task syntax
  before context reads, hashes rather than emits the task, recomputes accepted
  WO-A profiles from current data, cites active source-of-truth authority,
  preserves contradictions, and ranks bounded rules/symbols/examples/
  retrieval deterministically with exact observed/omitted accounting.
- Guidance reuses the normal lexical search projection without embeddings or
  provider/model/planner/fetch/telemetry paths. It does not persist profiles,
  index, config, task, cache, log, or output. Root/runtime loaders and public
  JSON/text errors fail closed without leaking task, path, source, loader, or
  warning content. Bootstrap/update/watch never invoke guidance.
- Integrated runtime/root help and routing, build inventory, ownership,
  scaffold instructions, package/runtime parity, contract documentation, and
  negative/boundary tests while preserving accepted WO-A, 2.5.2 two-pass
  search, progressive lifecycle, and containment behavior.
- Owner validation is green: pure 6/6; focused MCP 143/143; focused root 56/56;
  MCP 546/546; context 81/81; root 391/391; frontend 2,267 modules; five audits
  zero; version and syntax checks; packed 427 entries at 406/21 with 57
  changed/12 new; foreground bootstrap/update/watch; runtime parity and
  deterministic live state checks. The results record contains final immutable
  pattern/index evidence and reproduction commands.
- This is owner completion only. No acceptance, commit, merge, rebase, version,
  dependency, release, publish, WO-C, or WO-D action is authorized or taken.
  A fresh Code Quality, Contract, Security/Privacy, Integration, and Validation
  read-only review is the next bounded work order.

## 2026-08-25 — WO-B first-review remediation owner completion

- Packet 048 consolidates the five reviewer reports to six fix-now majors:
  exact pre-context target grammar; complete recursive/context-aware schema
  validation; capped evidence arrays with graph provenance; exact typed
  identity/live backing; the mandatory adversarial matrix; and immutable
  fail-closed evidence.
- Manager resolution removes `retrieval_evidence` and its cap from guidance
  schema v1. Guidance is only a deterministic convention-profile projection;
  normal search, related, and impact stay separate and unchanged. This is a
  pre-acceptance correction, not a compatibility migration.
- All six majors are owner-remediated. Exact target grammar and typed unique
  live backing run before context-dependent output; complete recursive and
  context-aware validation rejects rehashed fabricated projections; all four
  item classes retain capped evidence arrays and relation provenance. The
  mandatory malformed-target, nested-tamper, identity/backing, cap/reversal,
  prohibited-surface, lifecycle, and state-sentinel matrices are green.
- Validation is green at pure guidance 12/12, conventions 108/108, combined
  MCP focus 149/149, focused root 34/34, full MCP 552/552, context 81/81, root
  392/392, frontend 2,267 modules, and five zero-vulnerability audits. Packed
  containment is 427 entries at 406/21 with 53 changed/12 new. Expanded index
  evidence is 170 files/1,492 entities/18 profiles and 23/23 patterns; restored
  normal evidence is 155 files/1,434 entities/12 profiles with zero failures.
- This is owner completion only. No acceptance, commit, merge, rebase,
  release, publish, version/dependency action, WO-C, or WO-D is recorded. A
  fresh five-role read-only remediation re-review is mandatory.

## 2026-08-25 — WO-B final-remediation owner completion

- Packet 049 records the exact Security, Contract, Code Quality, Integration,
  and Validation dispositions. The empty-name chunk form now fails root
  preflight with sanitized JSON/text before missing, broken, or import-capable
  runtime access; the full root/runtime grammar matrix is differential-tested.
- Recursive validation now closes observed/retained/omitted/matched-term
  accounting. Caller/test examples preserve a real accepted CALLS/IMPORTS edge
  and reusable-symbol identity. Context-backed 10-to-11 evidence reaches every
  item class and passes context-aware validation.
- Exact scalar/byte, 32-to-33, NFKC/tie, profile fallback/multilanguage,
  typed/backing/containment, prohibited-surface, and accepted-base output
  matrices are complete. Impossible byte/profile/directory-hard-link cases are
  documented as physical non-applicability rather than fabricated tests.
- Validation is green: build; focused 147/147; MCP 555/555; context 81/81;
  root 394/394; frontend 2,267; five audits zero; version 2.5.2; packed 427 at
  406/21 with 53 changed/12 new; accepted-base search/related/impact bytes and
  two-pass sources unchanged; fresh managed bootstrap/guidance/watch parity.
- The exact 26-path accounting is 19 modified plus 7 added. The results record
  contains literal config expansion/restoration, both 23-target digests,
  checksum/profile/manifest validation, and exact 18-state replay commands.
  This is owner completion only: no acceptance, commit, merge, rebase, release,
  publish, WO-C, or WO-D action is authorized or taken.

## 2026-08-25 — WO-B terminal NO-GO remediation owner completion

- Packet 050 captures exactly three terminal majors. Standalone public
  serialization now recomputes normalized task accounting and every relevance
  component from the raw task and exact rule/symbol/example field allowlists.
  Coherently rehashed upward counts, fabricated terms, exact/prefix swaps, and
  altered matched fields/components fail public and context validation.
- Accepted convention builder/schema/public behavior and tests are byte-exact
  to `d326227`. Convention representative caller/test citations remain
  citation-only. Guidance joins them to the direct canonical CALLS/IMPORTS
  relation and reusable-symbol identity without changing profile hashes.
- Validation is green: build and focused 148/148; MCP 556/556; context 81/81;
  root 394/394; frontend 2,267; five audits zero; version 2.5.2; packed 427 at
  406/21 with unchanged inventory digest; base conventions source/tests exact.
- The terminal candidate is 25 paths: 17 modified, 8 added, 21 covered outputs,
  and packets 047–050. The results record contains the literal final managed,
  expanded/normal, 21-pattern, configured-path/checksum, complete manifest,
  canonical profile/context/backing, four accepted-base public-byte, and
  18-state sequence. No acceptance, commit, release, WO-C, or WO-D occurred.

## 2026-08-25 — WO-B accepted locally

- The single independent final reviewer first returned NO-GO on public
  raw-task recomputation, accepted convention-byte preservation, and final
  immutable reproduction. Packet 050 remediated all three without changing
  version, dependencies, accepted search/related/impact/two-pass behavior, or
  WO-A convention source/tests/public bytes.
- The same reviewer performed one narrow read-only delta verification and
  returned final GO with no actionable finding. It independently reproduced
  serializer rejection of coherent rehash tampering, byte-identical accepted
  conventions, the four accepted-base output hashes, 157 configured document
  checksums, 12 canonical context/backing-valid profiles, complete manifests,
  exact 21-pattern evidence, and 18-state neutrality.
- Manager decision: WO-B is accepted locally. The accepted scope is exactly 25
  paths (17 modified, 8 added), with validation at focused 148/148, MCP
  556/556, context 81/81, root 394/394, frontend 2,267 modules, five zero
  audits, packed 427 at 406/21, doctor 8/8, and watcher stopped. No commit,
  push, merge, release, publish, WO-C, or WO-D action occurred. WO-C may begin
  only as a separate fresh work order.

## 2026-08-03

- Created `plan/r16-ingest-filesystem-containment` from `main` at `6052686`.
- Used Cortex rules, search, and impact plus direct inspection of canonical
  ingest discovery, pipeline, I/O, and worker paths to scope R16.
- Added program packet 022, the detailed containment plan, WO-032 through
  WO-035, and REQ-16 traceability. The plan separates policy/characterization,
  source reads, output mutation, and packed-artifact acceptance so each work
  order can run in a fresh bounded session.
- R16 stays open. No runtime, release metadata, publish, tag, merge, or deploy
  action was taken.
- WO-032 characterized only synthetic temporary-root layouts. It confirmed
  current absolute/parent/explicit-symlink reads, symlinked control consumption,
  cache-parent redirection, direct symlink/hard-link truncation, and partial
  output replacement before a special-leaf failure.
- Added `wo-032-ingest-filesystem-containment-baseline.md` with the complete
  read/write inventory, frozen valid contracts, fail-closed ordering, bounded
  error ownership, migration rules, and honest concurrent-mutator residual.
  Added focused packet 023 for WO-033. Focused compatibility tests pass 19/19.
- WO-032's first review returned Contract and Security/Privacy majors. A
  documentation-only iteration addresses every finding without changing
  runtime behavior, tests, version, package, R16 status, or release state.
  Re-review remains required and WO-033 is still blocked.
- Parser query/WASM/.NET projects, DLLs, executables, optional publish/restore,
  and environment overrides are recorded as trusted package/operator
  toolchain artifacts, outside R16's ingest-managed data outputs. Existing
  dashboard `npm view` and optional .NET restore may use the network; the
  narrower requirement is no new source-data egress, telemetry, or network
  path.
- WO-034 now owns dashboard cache/embeddings manifests, relation JSONL, and
  npm-cache access, including denial before external read/mutation or npm
  invocation. WO-033 retains dashboard source scanning and must fail before
  `gatherData()` on unsafe controls/sources.
- Review-fix validation passed: C#/VB parser compatibility 25/25, context
  regressions 81/81, diff check, pattern evidence for 9/9 changed docs, Cortex
  update/graph completion with 0 failed, doctor 8/8, watcher stopped.
- Applied the two manager-specified pre-acceptance minor documentation
  corrections: the C#/VB target-framework overrides now use their exact
  `CORTEX_CSHARP_PARSER_TFM` and `CORTEX_VBNET_PARSER_TFM` names, and packet
  022 scopes the privacy statement to R16 source-data egress plus this
  program's no-new-telemetry or network-path requirement.
- Independent Contract and Security/Privacy re-reviews both returned PASS with
  no blocker or major finding. After the two minor corrections above, the
  manager accepted WO-032 and advanced WO-033 to Ready. R16 remains open.
- WO-033 implemented the canonical `filesystem-boundary.mjs`, immutable
  versioned real-root anchors, closed policy diagnostics and worker envelopes,
  contained control/source/Git/hydration/README/worker reads, and root/packaged
  dashboard source parity. The 25-case boundary matrix and frozen compatibility
  evidence passed; full root passed 348/348, context 81/81, MCP 413/413, and the
  `2.4.2` pack contained 418 entries.
- Initial review found parser, root rebinding, worker authority, dashboard
  lifecycle, diagnostic, and matrix gaps. `5ff7ece` fixed those findings. A
  final Security re-review found that arbitrary worker result objects could be
  downgraded to ordinary parse failures; `53a463c` now accepts only exact
  `{ chunks, errors }` array-valued results and adds the missing absolute ADR
  hydration case. Security and Contract re-reviews passed with no remaining
  finding; Code Quality/Integration had already passed.
- The manager accepted WO-033 locally and advanced WO-034 to Ready from packet
  024. Package/release metadata remains `2.4.2`; no merge, tag, publish, deploy,
  or R16 closure occurred.

## 2026-08-20 — 2.5.0 release recovery assigned

- The user authorized staging, commit, push, a non-draft PR, merge, the minor
  Release Bump workflow, npm publication, verification, cleanup, and a release
  summary.
- The release scope is accepted WO-033, completed/reviewed WO-034 and WO-035,
  and accepted WO-046 progressive background indexing. WO-036 through WO-045
  retrieval/benchmark experiments and local `.context` changes are excluded.
- Work continues in a clean `release/2.5.0` worktree from accepted WO-033.
  The mixed original checkout is reference-only. WO-034 is assigned from
  packet 024 before WO-035 packed validation and WO-046 integration.
- Required reviewers are Code Quality/Integration, Contract/Security,
  Validation, and Ops/Release. No GitHub or registry mutation occurs until the
  combined release gates are green.
- WO-034 implementation extends the accepted canonical boundary to all seven
  prior-cache files, segment-by-segment output directory construction, all 48
  exclusive stages and deterministic manifest-last commits, failure cleanup,
  and the complete dashboard manifest/relation/embedding/npm-cache layout.
  The recovered mixed implementation was used only as reference; WO-046
  `generation_id`/schema changes, Git-ignore discovery, and WO-036 through
  WO-045 retrieval/benchmark code were not ported.
- Review findings were triaged fix-now except the dependency update, which is
  deliberately assigned as a hard WO-035 release blocker. The codefix adds a
  separate 2-parent/48-final/48-stage precommit pass, cleanup after contained
  parent relocation, npm-cache policy propagation in both dashboards, the
  factorized leaf/ancestor matrix, and removal of the unused predictable
  `stageJsonl()` helper.
- Benign temporary-root evidence passes: boundary 41/41, frozen
  ingest/dashboard compatibility 19/19, context regressions 81/81, full root
  364/364, and full MCP 413/413. Syntax and diff checks pass. The initial
  pre-build inventory was 416 entries; the authoritative post-build dry-run
  and real `2.4.2` tarball contain 417. A clean-prefix installed-artifact full
  ingest reproduced 26/21 outputs, both frozen full hashes, all 17 traces, and
  manifest-before-completion ordering.
- Added the WO-034 implementation baseline and focused packet 025 for WO-035.
  WO-034 remains unaccepted pending independent re-review; WO-035 execution,
  version changes, commits, and all GitHub/release actions have not started.
- Target-local ignored `.context` bootstrap completed. Its forced legacy
  migration also attempted out-of-scope tracked `.gitignore`, root `scripts/`,
  and generated architecture-doc changes; these were isolated and exactly
  patch-restored, including executable modes, until status matched the saved
  pre-init 15-file WO-034 scope. No further forced init is allowed here.
  A review-fix target update completed with 48 embedded/792 reused/0 failed, indexed
  pattern evidence passed 8/8, doctor passed 8/8, and watcher is stopped.
- The package-owned MCP audit fails with 1 moderate and 4 high vulnerable
  packages: `hono`, `brace-expansion`, `fast-uri`, `ip-address`, and
  `js-yaml`. No dependency or lockfile is changed in WO-034. R3 is reopened
  and WO-035/release readiness is hard-blocked until a separate dependency
  iteration updates, fully retests, and returns every committed audit to zero.

## 2026-08-20 — WO-034 accepted; WO-035 dependency gate starts

- The first review returned whole-set precommit and dashboard policy majors,
  incomplete negative coverage, a dead unsafe staging helper, missing packed
  and target-Cortex evidence, and a non-zero dependency gate. Every WO-034
  code/validation finding was fixed and independently reproduced.
- Final evidence is boundary 41/41, frozen compatibility 19/19, context 81/81,
  root 364/364, MCP 413/413, authoritative 417-entry tarball plus clean-prefix
  ingest/hash/trace smoke, target update with 48 embedded/792 reused/0 failed,
  indexed pattern evidence 8/8, doctor 8/8, and watcher stopped.
- Code Quality/Integration, Contract/Security, and Validation/Ops re-reviews
  all returned GO with no remaining blocker, major, or minor finding. The
  manager accepts WO-034 locally and advances WO-035.
- Release remains NO-GO. WO-035 must first remediate MCP 1 moderate/4 high
  (`hono`, `brace-expansion`, `fast-uri`, `ip-address`, `js-yaml`) and frontend
  1 high (`nanoid`) to zero without a waiver, then repeat the full packed
  negative acceptance before deciding R16 or integrating WO-046.

## 2026-08-20 — WO-035 first pass ready for independent review

- Exact same-major pins/overrides move MCP to `hono 4.12.34`,
  `brace-expansion 5.0.9`, `fast-uri 3.1.5`, `ip-address 10.4.0`, and
  `js-yaml 4.3.1`, and frontend to `nanoid 3.3.18`. The canonical four audits
  and the extra root audit are zero; clean installs, MCP/frontend builds, root
  364/364, and MCP 413/413 pass.
- Added a standalone packed containment harness. A real 417-entry `2.4.2`
  tarball with 396 `0644` and 21 `0755` entries was extracted and installed
  into a clean prefix. Installed files pass boundary 41/41, characterization
  3/3, dashboard 4/4, all four frozen hashes, 26/21 counts, 17 traces, 93/93
  runtime ownership, and managed-replacement/protected/unknown preservation.
- The first pass recommends semver minor `2.5.0`: formerly unsafe external or
  redirected layouts intentionally fail closed, while repeated-separator and
  interior-dot aliases receive a backward-compatible changed-mode correctness
  fix. R3 mitigation and R16 closure are technical candidates only until the
  required independent panel and manager accept them.
- Release remains NO-GO. No version, changelog, WO-046, commit, GitHub, tag,
  publish, or deploy action has occurred.

## 2026-08-20 — WO-035 first-review findings fixed for re-review

- Code/Integration returned NO-GO because the four rendering tests imported
  only the copied development dashboard, inventory checks were spot checks,
  ownership was not exact, and force-init started from the candidate rather
  than released `v2.4.2`. Security independently reproduced 417 entries with
  a pre-existing ignored MCP build marker versus 416 from a clean checkout.
  Validation/Ops also noted the hard-coded candidate version and absence of a
  release-workflow gate. Packet 025 lacked its required Work Profile.
- The fix chooses the 416-entry clean-checkout contract. Root package metadata
  includes only `scaffold/mcp/dist/**/*.js`, so the local
  `.cortex-build-hash` cannot enter the artifact. The harness locks all sorted
  path/mode pairs at digest
  `c278da28d82a55abb60706b8fb2ad2bf0f77dc35709f4c9fa94056a4226ed5d2`,
  exact counts 395 `0644`/21 `0755`, and proves clean/prebuilt equality.
- Installed rendering now runs four cases directly against the packaged
  `scaffold/scripts/dashboard.mjs`; development rendering is reported
  separately. Ownership is exact at 381 unique managed paths and 93 packaged
  runtime paths.
- Force upgrade initializes offline from verified tag `v2.4.2` commit
  `736becf34d929ea0bef88adbe476a584a1f081e9`, then verifies all 14 changed
  managed scripts, the one new file, and all 14 installed state hashes while
  preserving config, ontology, and an unknown script.
- The harness reads candidate package metadata dynamically and is exposed as
  `release:packed-containment`. Both Release Bump and Release Publish now run
  it after locked builds/tests/audits and before tag or npm publication.
  Packet 025 declares exactly one `Infra/deploy/security-sensitive` profile.
- The complete fix-iteration rerun is green: clean installs and MCP/frontend
  builds; five zero audits; syntax/workflow YAML/version/diff; boundary 41/41;
  frozen 19/19; context 81/81; root 364/364; MCP 413/413; the packed matrix
  above; Cortex update with zero failed embeddings; indexed patterns 7/7;
  doctor 8/8; watcher stopped.
- Release remains NO-GO and R3/R16 remain review-pending until the full
  iteration matrix and independent panel are green. No version, commit,
  GitHub, tag, publish, deploy, or WO-046 action occurred.

## 2026-08-20 — WO-035 accepted after independent re-review

- Code/Integration, Security/Dependency, and Validation/Ops independently
  reproduced the fixed package, installed-dashboard, released-tag upgrade,
  dependency, workflow, and simulated `2.5.0` gates. All three returned GO
  without a blocker, major, or minor finding.
- The manager accepts WO-035. R3 is mitigated without waiver and R16 is closed
  as mitigated, retaining the documented trusted-same-user syscall interval and
  possible deterministic commit prefix as residual notes.
- Semver minor `2.5.0` is accepted. This decision authorizes the already
  requested next integration/release work but does not itself bump metadata,
  integrate WO-046, push, merge, tag, or publish.

## 2026-08-20 — WO-047 release integration first pass

- Started fresh packet 036 with the single
  `Infra/deploy/security-sensitive` profile on branch
  `release/2.5.0-final` from accepted WO-035 commit `e86ce65`.
- Integrated accepted WO-046 progressive background indexing without
  `search.ts`, `searchResults.ts`, `searchAspects.ts`, WO-036 through
  WO-045 retrieval/ranking files, semantic-quality docs, or local
  `.context/config.yaml` changes. Foreground remains default.
- Combined WO-046 ingest schema/generation fields manually with the accepted
  WO-034 whole-set staging and manifest-last implementation. The 14 frozen
  Angular source hashes and harness hash all match the final combined source,
  so the accepted frozen run remains valid and no regeneration is required.
- Refreshed the packed contract to 420 entries at 399/21 modes, inventory
  digest `cebf97a…48bd`, 385 managed paths, and 94 packaged runtime paths.
  The upgrade gate now compares the actual candidate artifact to the published
  `@danielblomma/cortex-mcp@2.4.2` artifact bound by SHA-1 and SRI, and validates
  all 38 changed managed files/state hashes, including five new files, while
  preserving protected and unknown content.
- Added the 2.5.0 changelog with progressive lifecycle/support/defaults,
  generation/snapshot/graph semantics, filesystem migration, six dependency
  remediations, zero-audit gates, and upgrade commands. Version metadata
  remains 2.4.2 for the post-merge minor-bump workflow.
- Focused CLI, Angular helper, MCP graph/progressive, migration/ownership, and
  packed installed-artifact gates are green. Root context 81/81 plus Node
  380/380, MCP 420/420, frontend production build, five zero audits,
  version-sync at unchanged 2.4.2, syntax, and diff checks also pass. Final
  Cortex changed update embedded 42/reused 125/failed 0 and rebuilt the graph;
  pattern evidence ran for all 21 indexed candidate paths. Doctor passes all
  runtime/index checks and fails only its expected dirty-worktree freshness
  calculation (7/8); watcher is stopped. Independent Security/Ops/Validation
  review remains before acceptance.

## 2026-08-20 — WO-047 review round 1 fixes

- Round 1 returned NO-GO for redirected graph/semantic storage, missing
  progressive graph-generation validation, an owner-initialization lock race,
  branch-capable manual Release Publish, and release-note/audit evidence gaps.
- Project-root-anchored managed-directory/file validation now precedes graph
  cache/DB/import/staging/manifest/publication and semantic/status/search I/O.
  Negative symlink, file, FIFO, socket, and staging-leaf cases prove zero
  external mutation while crash/retention behavior remains green.
- Progressive embedding readiness now requires a present graph generation that
  exactly matches the published graph manifest; foreground manifests remain
  compatible. The indexing lock gives fresh ownerless/malformed claims a
  bounded initialization grace and a deterministic two-contender test proves
  exactly one mutation proceeds.
- Release Publish now requires a strict `vX.Y.Z` tag before checkout and exact
  package equality before install/publish. The canonical audit command now
  runs all five committed dependency trees. Upgrade notes wait for progressive
  completion before `cortex update` and scope configured-root backslash denial
  without rejecting literal POSIX discovered filenames.
- Six changed source bindings superseded the WO-046 report. Fresh evidence
  comes from `https://github.com/angular/angular.git` at detached commit
  `71bb19d772aa77a30922fb896f775b58a0862c36`, using the accepted six-path
  scope bound by context-config SHA `39aa161…06e5`. Report SHA is
  `210b0d5…6cbd`; harness SHA is `ad3a607…ad30`; all 14 source bindings match.
  It reached search readiness in 10.824 seconds, returned the CLI in 12.833
  seconds, completed in 294.251 seconds, resumed a real SIGTERM at 4,131, and
  produced 16,314-record byte/query parity with 8/8 final queries.
- Final focused tests are CLI 15/15, harness 2/2, workflow 9/9, and MCP
  graph/progressive 14/14. Full root is 81/81 plus 384/384, MCP is 426/426,
  frontend builds 2,267 modules, and all five audits are zero. The final pack
  remains 420 entries at 399/21 modes with digest `cebf97a…48bd`, ownership
  385/94, installed 41/41 + 3/3 + dashboards 4/4, and 38 upgrade hashes/five
  new files from the published v2.4.2 artifact. The candidate is frozen for
  independent re-review without stage, commit, version, or release mutation.
- Final Cortex refresh embedded 63/reused 106/failed 0, all 21 indexed changed
  paths produced pattern evidence, and the watcher is stopped. Doctor passes
  7/8 with only the expected dirty-candidate freshness check failing.

## 2026-08-20 — WO-047 review round 2 fixes

- Round 2 rejected the one-second owner-initialization grace and required
  atomic publication of a completely initialized claim. The launcher now
  creates a private same-parent stage, writes and fsyncs `owner.json`, fsyncs
  the stage, and atomically renames it to `indexing.lock`. Exact run/token
  ownership is rechecked before mutation and release. Malformed/ownerless
  canonical claims fail closed; only fully valid dead owners and safe-name
  private dead artifacts are reclaimed.
- Deterministic regressions cover a live contender delayed beyond 1.1 seconds,
  eight simultaneous contenders with exactly one mutation, and
  crash-before-publication recovery. All fake workers validate the inherited
  handshake descriptor before acknowledging or writing state; four parallel
  repeated fixture loops pass 16/16.
- Because three bound runtime files changed, the first WO-047 Angular report
  is superseded. The new six-scope report SHA is `222fd88…e24c`; harness SHA
  remains `ad3a607…ad30`, config SHA remains `39aa161…06e5`, and all 14 source
  bindings match. Search readiness is 26.751 seconds, CLI return is 28.349
  seconds, completion is 290.588 seconds, and a real SIGTERM resumes from
  4,129 records to 16,314-record byte/query parity with 8/8 final queries.
- Final focused tests are CLI/lock 17/17, harness 2/2, workflow 9/9, repeated
  handshakes 16/16, and MCP graph/progressive 14/14. Full root is 81/81 plus
  386/386, MCP is 426/426, frontend builds 2,267 modules, and all five audits
  are zero. The installed pack remains 420 entries at 399/21 modes with digest
  `cebf97a…48bd`, ownership 385/94, installed 41/41 + 3/3 + dashboards 4/4,
  and 38 upgrade hashes/five new files from the published v2.4.2 artifact.
- Per-run candidate tarball hashes are intentionally not durable acceptance
  claims; the authoritative deterministic candidate contract is the sorted
  path/mode inventory digest. The published v2.4.2 SHA-1/SRI binding remains.
  The candidate is frozen for a third independent review without stage,
  commit, version, or release mutation.
- Final Cortex changed refresh embedded 54 entities, reused 116, and failed
  zero across 21 candidate paths. Pattern evidence is 21/21 (20 local plus the
  README repository fallback), the watcher is stopped, and doctor is 7/8 with
  only the expected dirty-candidate freshness calculation failing.

## 2026-08-20 — WO-047 accepted after final re-review

- Security/Contract reproduced the atomic delayed/eight-contender,
  crash-before-publication, malformed-lock, stale-reclaim, containment,
  generation, pack, audit, and Angular gates. Code/Integration repeated the
  handshake and full root/MCP suites. Validation/Ops verified the tag-only
  publish guard, release notes, full artifact, and final evidence chain.
- All three final reviewers returned GO without a blocker, major, minor, or
  note finding. The manager accepts WO-047 and marks R17 mitigated without a
  waiver.
- The exact 52-path `2.5.0` candidate is authorized for staging, commit, push,
  one non-draft PR, merge, minor Release Bump, tag-gated Publish, npm
  verification, and cleanup under the user's existing authorization.
- Commit `192295b` was pushed as `release/2.5.0-final`, and non-draft PR #113
  was opened against `main` with WO-033 through WO-035 and WO-046/047 plus
  REQ-4/16/17 and R3/15/16/17 traceability. Version metadata remains `2.4.2`
  until the post-merge minor Release Bump workflow.

## 2026-08-20 — WO-048 release CI recovery assigned

- PR #113 merged as `f2a6e6c`. Release Bump run `32393046529` failed in the
  root filesystem-boundary suite before release commit, tag, or publication.
- Linux exposed two narrow containment gaps: a removed/recreated stage may
  reuse the same `dev`/`ino`, and a warm dashboard version cache may return
  before revalidating the managed npm-cache path.
- Packet 037 assigns a narrow recovery from `origin/main`. The accepted
  progressive runtime, Angular evidence, package inventory, and public 2.5.0
  scope remain unchanged.

## 2026-08-20 — WO-048 first pass and review intake correction

- The first pass strengthens file/stage identity with `ctimeNs`, leaves
  directory identity at stable `dev`/`ino`, revalidates both dashboard
  npm-cache paths before returning warm version-cache data, and adds
  deterministic same-inode/warm-cache regressions.
- Validation is green: boundary 41/41, Linux Node 22 reproduction 2/2, root
  81/81 + 386/386, sequential MCP 426/426, frontend 2,267 modules, five audits
  zero, packed containment 420 entries with unchanged inventory digest, and
  syntax/version/diff checks. None of the frozen Angular report's 14 bound
  source files changed.
- Security review correctly rejected the initial intake because packet 037 did
  not state a Work Profile/reviewer panel and the durable handoff was still
  assignment-only. This policy major is fix-now: packet 037 and the handoff now
  contain the exact scope, reviewers, tests, risks, and open decisions before
  re-review continues.

## 2026-08-20 — WO-048 accepted locally

- Security/Contract, Code/Integration, and Validation/Ops independently return
  GO with zero blocker, major, minor, or note findings after the control-record
  fix. R16 and REQ-16 are mitigated through WO-048 with the existing same-user
  syscall interval and possible commit-prefix residuals unchanged.
- The accepted scope is exactly ten paths. Linux Node 22 focused tests are 2/2,
  boundary is 41/41, root is 81/81 + 386/386, sequential MCP is 426/426,
  frontend builds 2,267 modules, five audits are zero, and the 420-entry packed
  inventory/ownership/upgrade gate remains green.
- No frozen Angular source binding changed, so the accepted report remains
  valid. Release recovery is authorized for exact staging, a narrow PR, merge,
  a new minor Release Bump dispatch, tag-gated Publish, npm verification, and
  cleanup. The failed workflow must not be rerun at its old SHA.
- Cortex search/rules/impact were used before the code change. A clean-worktree
  refresh was unavailable because the installed CLI lacks the candidate
  scaffold; no mutating bootstrap/init workaround was used. Pattern evidence
  succeeded for both dashboard mirrors and the regression test; the canonical
  boundary target hit the pre-existing `aliases is not iterable` diagnostic.
- Commit `0ca5229` was pushed and non-draft recovery PR #114 was opened against
  `main`. The branch remains at version `2.4.2`; a local transient 2.5.0
  workflow simulation passed both previously failing tests 2/2 and was restored
  before the push.

## 2026-08-20 — WO-049 publish recovery assigned

- PR #114 merged as `74c5876`. Release Bump run `32395256781` passed every gate,
  committed `release: v2.5.0` as `4887baa`, created immutable tag `v2.5.0`, and
  triggered Publish run `32395455646`.
- Publish validated the tag, metadata, root 386, MCP 426, and five audits. Its
  installed boundary passed 41/41, but the parent harness rejected Node 24's
  successful `ℹ pass 41` summary because it only matched Node 22/TAP
  `# pass 41`. Package verification and npm publish were skipped; npm latest
  remains 2.4.2.
- Packet 038 assigns a reporter-compatible harness-only fix and patch release
  2.5.1. The immutable unpublished v2.5.0 tag will not be moved or reused.

## 2026-08-20 — WO-049 first pass and review intake

- The exact eight-path candidate adds one bounded summary helper accepting only
  Node's line-start `#` or `ℹ` markers while retaining every exact pass-count
  and zero-failure assertion. Runtime, package inventory, dependencies,
  workflows, and frozen Angular source bindings are unchanged.
- The full packed-artifact gate passes on local Node 22 and containerized
  non-root Node 24.19.0 with the same 420 entries, 399/21 modes, inventory
  digest `cebf97a…48bd`, installed 41/3/4/4 totals, ownership 385/94, and
  upgrade 38 changed/five new. Syntax, version sync, and diff checks pass.
- One root-container diagnostic is superseded: root legitimately bypassed two
  unreadable-file fixtures. The non-root rerun matching GitHub Actions is green.
  The candidate is frozen for the named three-way independent review.
- Cortex pattern evidence, update, and watch status were attempted in the clean
  worktree and failed closed because the installed 2.4.1 CLI requires a
  mutating scaffold bootstrap. No init/auto-migration workaround was used.

## 2026-08-20 — WO-049 accepted locally

- Security/Contract, Code/Integration, and Validation/Ops/Release all return GO
  with zero remaining blocker, major, minor, or note findings. Code review's
  one accuracy minor was fixed by saying package inventory, not package
  content, because the changed changelog is intentionally packaged.
- The manager accepts the exact eight-path candidate and marks R18 mitigated
  without waiver. Authorized execution is one exact commit/PR, merge, a new
  patch Release Bump, immutable `v2.5.1`, tag-gated Publish, npm verification,
  install smoke, and cleanup. The old Publish run is not rerun and `v2.5.0`
  remains immutable and unpublished.
- Commit `133ff10` was pushed on `release/2.5.1-recovery`, and non-draft PR
  #115 was opened against `main` with REQ-4/R18 traceability.

## 2026-08-20 — 2.5.1 published and WO-049 closed

- PR #115 merged as `e429319`. Release Bump run `32396681426` passed every gate,
  committed `release: v2.5.1` as `a3d5a11`, created the immutable `v2.5.1`
  tag, and triggered Publish run `32396882517`.
- The Node 24 Publish run passed tag/metadata checks, root and MCP suites, five
  audits, the repaired packed-containment gate, package verification, and npm
  publication. npm `latest` is `2.5.1`; registry SHA-1 is
  `7e6b6282455950dbe1f48175ef5c8d23c779ba7a`; a clean-prefix install reports
  package version `2.5.1`.
- `v2.5.0` remains an immutable annotated tag at `4887baa` and remains
  unpublished. WO-049 and R18 are closed without waiver; cleanup may proceed.

## Archive

- `archive/manager-log-2026-07-29.md` — foundation through WO-030 acceptance.
- `archive/manager-log-2026-07-30.md` — WO-031 acceptance and v2.4.2 release
  recovery.
