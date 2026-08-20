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

## Open Decisions

- Whether `cortex mcp` is deprecated for one release or removed directly in a
  future breaking release.
- Whether `@danielblomma/cortex-mcp` is retained as the npm package name during
  the CLI-first migration or followed by a new package with a migration
  window.
- Final integration/review evidence after accepted WO-046 is applied on top of
  WO-035 and the locked package inventory is refreshed for `2.5.0`.

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

## Archive

- `archive/manager-log-2026-07-29.md` — foundation through WO-030 acceptance.
- `archive/manager-log-2026-07-30.md` — WO-031 acceptance and v2.4.2 release
  recovery.
