# WO-LOCAL-003 release readiness — reviewed, publication blocked

2026-09-10. Profile: Infra/deploy/security-sensitive. Source candidate PR130 was
3c5d4da028f169255c14fb8230392c922cc5b12a, based on main37a511f. Implementation
commits: 2eb9190359a31a7db3237c00c48b185d840cf280 and
31fc32e47f0a5e42d4dd08cdd150f803335e1719. Subsequent commits contain control
reports only. PR: https://github.com/DanielBlomma/cortex/pull/130.

## Authority and disposition

User authorized the next minor release and its necessary readiness repairs, and
subsequently chose “Ja, uppdatera lokal CLI också”. This supersedes the earlier
local-002 no-release scope. Publication must pass the restored gates; no gate
waiver was requested or applied. Root owns the authorized existing global CLI
installation under /opt/homebrew after successful publication. Package metadata
remains2.7.0; Release Bump now prepares2.8.0. No merge, tag, dispatch, npm
publication, or local installation was performed by this work order.

Both independent reviewers approve this patch for a blocked draft PR. This is
not manager merge/release acceptance: dependency audit still fails. The reviewed
Git-ignore source candidate and original historical checkout remain preserved;
manager changes are in an isolated clone. No other branch writer was used.

## Classified failures and repairs

The ten baseline root failures were independently reproduced. History477f17e
removed executable validation gates; these were real missing safeguards.
History27af175 subsequently established dual root/bundle publication, making the
root-only prohibitions obsolete. A hardcoded2.5.2 assertion was also obsolete.
Restoring gates and reconciling the actual released contract fixes all ten.

- Restore trusted runtime build, dependency installation, root/MCP/fresh-checkout,
  six-lock audits, packed containment, exact local artifact installation and
  pinned Harness lifecycle before tag/publication. Include frontend build.
- Preserve main equality, unused immutable annotated tag, complete eight-file
  metadata staging, atomic main+tag push, tag-only publishing, OIDC provenance,
  exact root/bundle integrity, safe resume, and root-before-bundle publication.
  Publish consumes the local artifacts that passed validation and compares their
  integrity to the initial tagged artifact proof.
- Prepare the existing next-minor workflow for2.7.0→2.8.0. It intentionally remains
  an explicit release target; a later release needs its own reviewed target edit.
- Restore root clean-install smoke and add both registry package installation and
  pinned registry Harness lifecycle after both exact registry verifications.
- Test actual executable gate commands, failure propagation, whole-step ordering,
  seed equality, install/Harness artifact bindings and dual registry identity.
  Remove the metadata mutation test's silent early return after2.5.2.
- Reconcile fresh-checkout exact totals from417root/426MCP to observed437/651,
  preserving exact-count failure behavior and bounded diagnostic tests.
- Ignore only generated scaffold/.context/mcp and scripts directories: the actual
  MCP review test otherwise fails its200changed-path safety limit. Tracked
  scaffold config/notes remain included.

Compatible security updates: js-yaml4.3.2, fast-uri3.1.6, hono4.13.5,
sharp0.35.4/libvips1.3.3, qs6.16.0; frontend browserslist4.28.9 and
baseline-browser-mapping2.11.21, plus their resolution-required transitives.
No ONNX or Transformers major/minor migration, vulnerable version disguise,
audit suppression, or source upload/provider operation was introduced.

## Independent review and iteration

Fresh reviewers were assigned before implementation and used separate clones.
Security/Privacy + Code Quality + Contract: `/root/release_manager/security_contract`.
Ops/Release + Validation + Integration: `/root/release_manager/ops_validation`.
Their reports are local-003-independent-security-review.md and
local-003-ops-validation-review.md in this directory.

Security found validators could accept removed pack/install bodies and wrong
Harness artifact binding. Added executable and identity checks plus independent
negative reproductions; closed on2eb9190. Ops found the silent metadata test
return, stale totals, generated runtime paths breaking review, and missing
registry bundle lifecycle smoke. All source findings are fixed; final review
binds31fc32e. No unresolved implementation review finding remains.

## Validation evidence and limits

| Gate | Result |
|---|---|
| Full root `npm test` | PASS81/81context,437/437root,6/6bundle; zero skips |
| Independent MCP `test:ci` | PASS651/651; zero skips,38.900s |
| Focused `release:test` | PASS41,0fail,1Linux-only skip of42; independent repeat agrees |
| Runtime locked install + build | PASS `npm ci --prefix scaffold/mcp` and TypeScript build |
| Frontend locked install + build | PASS; existing chunk-size advisory only |
| Release version sync | PASS2.7.0 |
| Six committed lock audits at low-or-higher | Root/frontend/both parser locks/bundle PASS0; MCP FAIL3moderate,0high |
| Packed containment | PASS465entries,48boundary,3characterization,4+4dashboard |
| Ownership/historical upgrade inside packed gate |423managed/96runtime;110changed/43new;110hashes verified |
| Pinned Harness source compatibility | Independent PASS18files at b150a551b8d465e31e418e1b2eaf5e79bbb7d28e |
| Additional standalone suites |301pass/6fail of307: six require absent external frozen benchmark packet |
| Fresh-checkout executable end-to-end | Not rerun in a pristine full release fixture; exact totals and diagnostic regressions pass, root/MCP suites independently pass |
| New2.8 duplicate artifact, empty-cache dual install, full packed/registry Harness lifecycle | Not run/claimed; immutable publication is blocked before those acceptance gates |
| GitHub CI / publication | No run dispatched; final PR state records actual checks separately |

The six external-fixture failures require the sibling AgentStackBench frozen
packet `results/run_suites/wo045-frozen-inputs-v10c/packet-set-v10c.json` in
bootstrapbench-two-pass-subsystem (2) and bootstrapbench-wo048-four-treatment (4).
No benchmark/provider execution or blanket test exclusion was added.
Initial local root preparation missed parser and bundle dependency installation;
those attempts failed visibly. Installing the locked prerequisites and regenerating
scoped context resolved them before the passing full root run. Ops reproduced
and then closed the generated-path MCP failure with the committed ignore fix.

Host: macOS/APFS, Node22.23.2, .NET8.0.422. Linux network isolation and distinct
NFC/NFD filesystem behavior still require their proper platform. Full release
acceptance must run the restored workflow on its Linux runner; local evidence
and an absent check are not substitutes for that run.

Packed inventory SHA256:
`b57403ef4d5f9e59946eaf130e361f55114e378ab4da3a4918cf1c1207811a1e`.
Packed candidate tarball SHA256:
`f35ce736540f882b4d496f0d4897d7c74a73d1d99c86cc39ca54eea3ac73f8f4`.
All four source/test SHA256 identities in local-002-gitignore-review.md remain
unchanged and were rechecked after the release repairs.

## Exact publication blocker and next fresh work order

All remaining audit entries are one unpatched chain:
`@huggingface/transformers → onnxruntime-node → adm-zip`.
[GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
reports symlink-following extraction permitting arbitrary file overwrite.
Registry latest adm-zip0.6.0 is affected, the advisory lists no patched release,
and [upstream PR575](https://github.com/cthackers/adm-zip/pull/575) is open as of
this review. Latest ONNX still uses adm-zip; the forced npm proposal is a breaking
Transformers4→3 downgrade. Neither that downgrade nor a scanner-hiding override
is an accepted compatible fix.

Unblock with a published, reviewed compatible adm-zip fix (or a separately
reviewed supported dependency path that eliminates it), update the narrow locked
resolution, and obtain zero findings from all six required audits. Then a fresh
manager must verify current PR/main/tag/npm identities, rerun focused/full and
pristine fresh-checkout gates, simulate2.8 metadata/artifact binding and local
Harness/install gates, run applicable Linux release gates, document unavailable external benchmark
prerequisites separately, and obtain independent
review before merge. Do not dispatch a2.8 immutable tag while publication is known
to fail. After accepted merge, use Release Bump's minor input on main and monitor
Bump plus Publish through exact registry artifacts and clean install. Only then
may root update the existing /opt/homebrew CLI and verify its resolved version.

## Cortex evidence

Repo skills used: using-cortex, change-impact, pattern-review, context-review.
Scoped lexical ingest+graph loads included only direct release/control references
and the exact query-command fixture required by MCP tests. No embeddings/provider
runs or background hooks. Temporary tracked context configuration was restored.
Search/impact/related identified validateBumpWorkflow, validatePublishWorkflow and
scripts/release-artifacts.mjs; six active rules returned. Final per-file pattern
calls succeed13/16. `.gitignore` is unsupported/unindexed; fresh-checkout helper
and its test return `INVALID_ARGS: aliases is not iterable`. Direct independent
review covers those files. Combined review previously failed safely; a clean
committed-tree review has zero changed files and is not claimed as diff evidence.
These are explicit tooling limitations, not advisory passes or gate waivers.
