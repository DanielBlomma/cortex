# Manager Log

Durable chronological log for scope, decisions, approvals, blockers, and
staging status. Do not rely on chat memory for acceptance or merge decisions.

Rotation rule: at each day rollover (or at ~150 lines), move the previous
day's entries to `archive/manager-log-YYYY-MM-DD.md` and refresh Current State.

## Current State (2026-08-20)

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

## Archive

- `archive/manager-log-2026-07-29.md` — foundation through WO-030 acceptance.
- `archive/manager-log-2026-07-30.md` — WO-031 acceptance and v2.4.2 release
  recovery.
