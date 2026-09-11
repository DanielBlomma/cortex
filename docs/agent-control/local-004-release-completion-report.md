# WO-LOCAL-004 release completion — validation in progress

2026-09-11. Infra/deploy/security-sensitive. Source candidate is
52bd6751e4e512c08a91ec533d623201a707eb40 for the dependency patch; hosted preflight
and its contract tests are reviewed at 0b1d53c9efc821f1f7c1ee96b6ab4f1889ded0f4.
The clean-tag CLI test repair is independently approved at
7699afb815b475fc7fe61acf711d8d0635795de3, not yet pushed at this checkpoint.
PR #130 remains a draft until the remaining gates pass. No publication is claimed.

## Authorized scope and implementation

The user authorized resolving the dependency blocker, final release validation,
merge, Release Bump/Publish 2.8.0, and the existing /opt/homebrew CLI update.
No gate waiver was requested or applied. Manager uses a fresh isolated clone;
root owns the global CLI update only after verified publication. Historical
original and previously reviewed checkouts remain preserved.

The dependency implementation change is the adm-zip lock entry:
version, official npm tarball URL, and integrity advance from 0.6.0 to 0.6.1.
The existing ^0.6.0 override, ONNX 1.24.3, Transformers and all other resolutions
remain unchanged. npm update --package-lock-only produced exactly this delta.

## Security and independent review

Fresh Security/Contract/Code Quality and Ops/Release/Validation/Integration
reviewers were assigned before implementation and used separate clones.
[Security report](local-004-independent-security-review.md) approves the narrow
52bd675 patch. All 20 published files match official v0.6.1 / gitHead cb2cf9b;
published integrity and both npm registry signatures verify. The official
upstream regression suite passes 122 tests. Source implements pre-existing
descendant-symlink rejection across extraction APIs independently of open PR 575.

Manager temporary-fixture checks additionally observe rejection and unchanged
sibling-file bytes for extractAllTo, extractAllToAsync, and extractEntryTo with
preserved and flattened paths. Ordinary extraction also passes. This manager
behavioral evidence is separate from the reviewer's upstream-suite evidence.
No provider/model calls or external target tests were involved. Existing ONNX
predictable temporary-directory/extraction-root trust and pre-check/write races
remain explicit minor residual risks for this unchanged caller; no claim of
complete race hardening is made.

## Measured local validation

Host: macOS, Node 22.23.2, npm 10.9.8, .NET 8.0.422.

| Gate | Result |
| --- | --- |
| Six lock-only audits, low or higher | PASS, zero vulnerabilities in all six trees |
| MCP locked clean install and build | PASS |
| Native ONNX tensor, sharp image round-trip, Transformers import | PASS; ONNX 1.24.3, sharp 0.35.4, adm-zip 0.6.1 |
| Full root and bundle | PASS: 81 context, 437 root, 6 bundle; zero skips |
| Focused release contracts | PASS: 41 pass, zero failures, one Linux-only skip on macOS |
| Frontend build | PASS; existing chunk-size advisory |
| Packed filesystem gate | PASS: 465 entries, 48 boundary, 3 characterization, 4 development and 4 packed dashboard cases |
| Ownership and historical upgrade | PASS: 423 managed / 96 runtime; 110 changed / 43 new; 110 installed hashes verified |
| Metadata synchronization | PASS, candidate remains 2.7.0 |
| Full MCP | PASS: 651/651, zero skips, 35.460s on simulated 2.8 metadata fixture |
| Linux x64 simulated 2.8 artifact gates | Independent packed, duplicate artifacts, seed equality, empty-cache dual install, pinned 18-file Harness contract and four black-box negatives PASS; emulated full lifecycle failed the unchanged 10-second Web SIGINT shutdown deadline |
| Pristine complete full regression | Hosted execution pending; emulated root reaches 81/437 PASS, bundle 5/6 due measured zombie reaping race |
| GitHub Bump/Publish and registry verification | Not dispatched; pending acceptance |

Packed inventory SHA256 is
b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e.
There are exactly 444 files mode 0644 and 21 mode 0755. This candidate macOS packed
tarball SHA256 is a07ddd2eae8fed7290857ad47e3f848b1a4f00217f8347c0232df293ae7aff37.
All four Git-ignore implementation/test SHA256 values from local-002 remain
unchanged. The six historical standalone failures require an absent external
frozen benchmark packet; no benchmark run, fixture fabrication or blanket test
exclusion was introduced. Prior standalone evidence remains explicitly limited.

## Diagnosed Linux prerequisite

The first ARM64 container attempt found a missing-loadable-ryugraph error.
Independent ELF inspection established that ryugraph 25.9.1's linux-arm64-labelled
prebuilt contains x86_64 machine code, as does its installed ryujs.node. npm logs
prove the install script ran successfully. The initial lifecycle-policy
hypothesis was retracted; no npm policy or OIDC change was made. This is an
existing upstream Linux ARM64 distribution limitation. Actual release workflows
use Linux x64, so validation switched to a disposable x64 container under Docker
emulation. Results for that platform will be recorded separately.

## Context and remaining gates

Repo using-cortex/change-impact/pattern-review/context-review skills applied.
Scoped lexical ingest and graph load used direct release references and the
query-command fixture; no embeddings or providers. Required release test context
preparation on configured repo/scaffold fixture paths is within existing user
authority. Temporary tracked config is restored before commits/artifact creation.
Search resolves file:scaffold/mcp/package-lock.json and release workflow/test
entities; impact/related succeed and six active rules return. Lock pattern
lookup succeeds. Guidance reports INVALID_ARGS: Guidance failed safely; combined
review with unindexed pending report reports INVALID_ARGS: Review failed safely.
These are explicit advisory-tool limits, not successful review verdicts. The
independent source review and focused executable gates remain separate evidence.

The initial local MCP fixture attempts failed review--diff because they carried
unindexed pending docs or a scoped tracked .context config. The test requires an
actual nonempty repository diff and creates none itself. The successful run uses
the same exact eight-file simulated 2.8 metadata mutation and local root artifact
binding as Release Bump; no test or production assertion was changed. All eight
metadata files were then restored to candidate 2.7.0.

## Hosted preflight and current disposition

Both independent reviewers approved 0b1d53c for draft-PR push after closing the
job-level skip/failure-masking validator gap and EOF whitespace finding. The new
read-only pull_request workflow mirrors Bump's executable validation bodies,
checks the default PR merge candidate, disables credential persistence, and has
no tagging/publishing capabilities. It derives only its simulated next minor so
future PRs remain usable; existing Bump/Publish guards are unchanged. Focused
counts remain 42 total, 41 pass and one macOS Linux-only skip; both reviewers
reproduced these results and negative mutations.

The coordinated fast-forward push updated PR #130 from 51a2767 to 0b1d53c.
Hosted Release Preflight is run 34595569328:
https://github.com/DanielBlomma/cortex/actions/runs/34595569328 .
PR head is 0b1d53c9efc821f1f7c1ee96b6ab4f1889ded0f4 and base is
37a511fa76ce04804f6cf4497202966dd78ff1f0. GitHub synthetic merge
f6b2db9b30b39472a9dcd343f88b942600f5d0e6 has tree
a83316c8930f4f7044cc11aff70fbf545b7f9243, equal to the local merge-tree result.
The PR remains draft pending the actual hosted result; no merge, tag, Bump/Publish
dispatch, npm publication or local CLI installation is claimed.

The emulated x64 fixture first had an unreaped owner zombie under PID1=sleep;
Docker --init repaired that environment and full root then passed 81/437.
A subsequent bundle cancellation check raced final zombie reaping. Independent
unchanged-assertion diagnosis passed 10/11 trials; the failed process was Z-state,
then absent, with no executing descendant leak. No assertion was changed or
waived. Actual hosted Ubuntu validation decides acceptance.



## Clean-tag test contract repair — 7699afb

Both reviewers found Publish's clean tagged tree conflicts with the CLI test's
ambient observed_count > 0 assertion. Publish packs and checks versions but
intentionally makes no metadata mutation. The review API supports clean output;
its dedicated tests already assert zero changes and exact positive fixtures.
Only the integration assertion changes to observed = items.length + omitted,
retaining schema, determinism, byte limits and state bytes/mtime invariance.
No production runtime, gate or timeout changed; test counts are unchanged.

Security independently reproduced the original clean failure and passes the
fixed clean CLI suite 18/18, owned dirty README case 1/1, dedicated clean/exact
five-path fixtures 2/2 and broader unchanged review suite 29/29. Ops independently
measures clean 0/0/0 and real simulated eight-metadata 8/8/0 accounting, with both
fixed target runs passing 1/1; all metadata restored afterwards. Both approve
exact 7699afb. See local-004-clean-tag-security-review.md and the final Ops report.

This test is shipped in the npm artifact. Earlier 52bd675/0b1d53c artifact hashes
are retained historical evidence and are superseded for final release identity;
updated-head preflight must repack and validate. First hosted run 34595569328 on
0b1d53c has passed full root/bundle, MCP, pristine fresh-checkout and all six audits,
then packed containment, frontend, duplicate artifact/empty-cache install and
pinned Harness source contract. It is currently running full Harness lifecycle.
No missing/failed gate is treated as a pass, and no immutable release operation
has occurred. A fresh bounded manager will receive exact run/head handoff after
the imminent native lifecycle outcome.


## Final native outcome and fresh-manager handoff

Hosted run 34595569328 completed FAILURE on actual Ubuntu x64 at the full Harness
Web shutdown gate: `Web profile did not stop within 10 seconds after SIGINT`.
Exit was 1 at 2026-09-11T11:57:45Z. All preceding steps passed; final diff/boundary
verification was skipped after failure. Full log and JSON are preserved in the
manager evidence directory, with the historical artifact report extracted.
This supersedes earlier in-progress wording. No assumption is made yet whether
the defect is release-helper process signalling or the pinned Harness lifecycle.
No deadline, assertion or gate is waived. Native diagnosis and an independently
reviewed repair are required before final-head validation, merge or publication.

Both reviewers approve clean-tag test source 7699afb; it remains local, with
remote PR #130 still draft at 0b1d53c, main37a511f, and no tag/publication.
[Fresh continuation packet](context-packets/local-005-hosted-release-completion.md)
contains complete authority, exact sources/reviews/logs and remaining work.
This is a safe context-window handoff; root will start the next fresh manager
automatically without asking the user to restart or repeat permission.
