# WO-LOCAL-002 Git-ignore review and validation

Date: 2026-09-10. Profile: Infra/deploy/security-sensitive.
Candidate branch: `fix/root-gitignore-discovery`, directly based on
`37a511fa76ce04804f6cf4497202966dd78ff1f0`. PR publication is authorized;
merge requires the outstanding gates. No release is authorized.

## Current disposition

Independent code/security and package reviews pass on the final candidate.
Earlier candidate results are superseded by the Unicode review fixes. Full merge
acceptance is blocked by ten existing root release-contract failures; no waiver
is granted. [PR #130](https://github.com/DanielBlomma/cortex/pull/130) is published as a draft with
`class:infra-sensitive` and remains blocked for merge. Runtime/source commit:
`37718f4287f80845663adcd3eea5d2db52188f46`. GitHub reports `MERGEABLE/CLEAN`,
with no status checks or Actions runs; this is conflict status, not gate
acceptance. No merge or release was performed.

## Reviewed behavior and iteration

Root `.` omits Git-ignored untracked paths, keeps tracked and ordinary untracked
paths, and honors explicit non-root selections in either order. Changed ingest
prunes newly ignored files, ADRs and dependent chunks from retained records.
Git failures are distinguished from positively identified non-Git directories;
subprocesses are shell-free, bounded to 30 seconds/32 MiB, stripped of ambient
`GIT_*` overrides, and checked against the project anchor. Errors are scrubbed.

Independent `/root/gitignore_security_review` found two major fix-now defects:

| Finding | Evidence | Resolution |
|---|---|---|
| SEC-01: UTF-8 decoding stripped a leading U+FEFF from Git path output, so ignored source could be indexed. | Real Git ignored-file reproduction; BOM project-prefix case. | `TextDecoder` uses `ignoreBOM: true`; regression preserves BOM as path data. |
| SEC-02: macOS Git precomposition disagreed with physical Unicode names; an initial fix still retained cache aliases from changed mode. | Real NFD file/directory and tracked-file fixtures; full → changed → ignore cache reproduction. | Preserve both Git's spelling and boundary-verified native physical spelling in the ignore set. Do not change Git's Unicode setting or apply unconditional Unicode normalization. |

Both independent reproductions pass after the final runtime fix. Existing test
groups now cover BOM paths, NFD ignored files/directories, retained tracked paths,
explicit selections, and pruning after an intervening changed ingest. A
filesystem-capability subcase covers distinct NFC/NFD files when supported.
The packed exact boundary count changes from 42 to the measured 48; inventory,
modes, ownership, upgrade and integrity assertions remain unchanged.

## Final source identity

| File | SHA-256 |
|---|---|
| scaffold/scripts/lib/ingest/files.mjs | 9ad1a67422f9554c91536ea12032c5a52274ae63ed1df25f53a5b384d57ec94b |
| scaffold/scripts/lib/ingest/pipeline-stages.mjs | fcf277a4e60b6fc48e7ad3bb1264424dea45af8d1cb2437d71258b8adf3c6c92 |
| tests/ingest-filesystem-boundary.test.mjs | c31dff36cfe7cdf66d9ee9200543bb3a3a186849bd0793242c5b9323d91e86d9 |
| tests/packed-filesystem-containment.test.mjs | a3f10fcadef5f14a94080fbda053dda6a8b6e93c644526f5ca884ed60b1d60fa |

## Independent gates

Reviewers were assigned before iteration and used separate checkouts. Manager
owns candidate integration; the original historical checkout is read-only.

| Reviewer/gate | Final result |
|---|---|
| Code/Contract/Security — `/root/gitignore_security_review` | GO for the final four-file candidate; both major findings closed. |
| Validation — `/root/gitignore_validation` | PASS focused 103/103, context 81/81, applicable unchanged Harness 6/6; root Node 427/437, ten baseline release-contract failures, zero skipped groups. |
| Ops/Integration — `/root/gitignore_package_review` | PASS: 48 boundary, 3 characterization, 4 development dashboard and 4 packaged dashboard cases; ownership 17/17, zero skips. |

Commands: focused `node --test tests/ingest-filesystem-boundary.test.mjs
tests/ingest-units.test.mjs tests/ingest-characterization.test.mjs
tests/dashboard.test.mjs`; full `npm test`; separate
`npm --prefix plugins/dsh-cortex test`; ownership
`node --test tests/scaffold-ownership.test.mjs`; package
`npm run release:packed-containment`. No dependency manifest/lock changed.

The untouched-main baseline from the incoming packet is 97/97 focused,
81/81 context regressions, 421/431 root Node tests with ten failures, and
6/6 Harness. Independent first candidate execution reproduced those same ten
failure categories with unchanged release tests/workflows/package inputs; exact
raw baseline logs were unavailable. Final rerun reproduces exactly the same ten
failed test names as the first independent candidate execution. Focused run: 21.561s;
root Node stage: 26.019s. Separate Harness 6/6 evidence is reused from the prior
iteration because its code/dependencies were unchanged. All four final hashes
were verified in candidate and validation trees after the runs.

Packed artifact: 465 entries, 444 mode `0644` and 21 mode `0755`; clean/prebuilt
inventories match. Ownership is 423 managed/96 runtime. The pinned published
v2.4.2 upgrade validates 110 changed/43 new managed files and 110 installed-state
hashes while preserving config, ontology and unknown files. Inventory SHA-256:
`b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e`.
Final tested tarball SHA-256:
`5ce76024e323347b474fef849d1b61cbd50939ac3966b127a6d7b996443a1e6c`.

## Cortex evidence and limitations

Installed CLI 2.4.1 initially refused missing local runtime. Manager copied the
already built locked runtime into candidate-local `.context` and indexed only
direct ingest sources/tests and work-order references with ingest + graph load.
No embedding/provider run occurred. The tracked context config was restored.
Ordinary `cortex update` unconditionally starts embedding, so its safe scoped
lexical/graph steps were run separately under this work order's explicit limit.

Current CLI 2.7.0 search, rules, impact, related, guidance and per-code-file
pattern evidence succeed on fresh candidate context. Six active rules were
returned; pattern evidence is advisory, not a compliance verdict. Direct source
review verifies `collectCandidateFiles` → pipeline state → hydration and existing
boundary/prior-publication ordering. Initial `review --diff --json` returned
`INVALID_ARGS: Review failed safely`. After refreshing final candidate context,
review succeeds with all four eligible code files reviewed, no conflicts, and
one heuristic warning at `files.mjs:247`. It suggests shared configuration
helpers (`arguments.mjs:22-78`) for the `process.env` access. Manager triage rejects
that suggestion as inapplicable: typed integer/boolean/trace readers cannot
enumerate and remove every ambient `GIT_*` override. Independent Security reviewer agrees with this triage.
No deterministic policy finding was returned. Pattern evidence succeeds for all
12 changed/new files. Relevant stable entities include
`file:scaffold/scripts/lib/ingest/files.mjs`,
`file:scaffold/scripts/lib/ingest/pipeline-stages.mjs`, and
`file:scaffold/scripts/lib/ingest/filesystem-boundary.mjs`.

Limitations: local host is macOS/APFS on Node 22.23.2/Git 2.54.0; NFC/NFD names
cannot coexist here, so the capability-gated distinct-name assertions await a
suitable filesystem. Timeout/output-limit error branches use injected results,
not elapsed 30-second/32-MiB stress runs. Native path handling retains the
existing trusted-same-user validation-to-syscall interval. Git metadata and global
ignore rules remain authoritative. The incoming MCP audit result (5 high,
5 moderate) is unchanged scope evidence, not a new audit or dependency waiver.

## Blockers and fresh-session continuation

The ten root failures concern three plugin-manifest release expectations and
seven release-workflow contracts, including stale 2.5.2 expectations versus
2.7.0, missing gate/fixture names, and registry-helper contracts. The failures
are unrelated to the four changed code/test files but still block merge here.
WO-RV-003/004 dependency/CI/release-contract remediation is separate work and is
not authorized merely by this Git-ignore review. No missing CI check is a pass.

A fresh manager should read this report, the current control-document entries,
and the linked PR; verify its exact head and current checks before proceeding.
Do not merge until the blocking gates are resolved under appropriate authority.
Do not start search experiments, provider calls, heavy indexing, or release.

Exact root failures (all outside changed test files):

- release bump builds the trusted runtime before root security tests
- release publish builds the trusted runtime before root security tests
- release publish rejects branch dispatches and non-semver tags before checkout
- committed candidate keeps every root and bundle version at 2.5.2
- release bump encodes exact synchronized staging and all pre-tag gates
- release bump regression validator rejects omitted bundle lock staging
- release workflows reject every npm credential and login path
- release publish is tag-only, root-first, exact-artifact, and resumable
- release publish rejects publication before local artifact and Harness gates
- release workflows reject bundle registry, publication, install, Harness, and summary mutations
