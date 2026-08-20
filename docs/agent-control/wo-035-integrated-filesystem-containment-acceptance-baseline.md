# WO-035 Integrated Filesystem-Containment Acceptance Baseline

## Review-Fix State

WO-035 starts from accepted WO-034 commit
`667aa5f3d61bb0c968c37ddef73409295e7556d3`. The first independent review was
NO-GO: it found that dashboard rendering evidence exercised only the copied
development adapter, package inventory and ownership were not exact, the
force test did not upgrade a released scaffold, packet 025 lacked a Work
Profile, and the standalone harness was absent from both release workflows.
Security review also reproduced an inventory split: the ignored local MCP
build marker produced 417 entries when already present and 416 from a clean
checkout.

The fix iteration closes those findings in code and evidence as described
below. It is ready for the same independent Code Quality/Integration,
Contract/Security and Privacy, Validation, and Ops/Release panel to re-review.
The first-review findings are closed. All three independent re-reviews are GO,
and the manager accepts WO-035 with R3 and R16 mitigated. Final `2.5.0`
integration and release actions remain a separate authorized sequence.

No version, changelog, GitHub, commit, tag, publish, deploy, or WO-046
integration action was performed. Package and release metadata remain
`2.4.2` while the intended next release classification is reviewed.

## Dependency Hard-Blocker Remediation

Registry advisory data and `npm audit` identified fixed releases within the
existing dependency majors. WO-035 pins only the affected direct/transitive
resolutions:

| Tree | Package | Before | Locked safe version |
|---|---|---:|---:|
| MCP | `hono` | 4.12.32 | 4.12.34 |
| MCP | `brace-expansion` | 5.0.8 | 5.0.9 |
| MCP | `fast-uri` | 3.1.4 | 3.1.5 |
| MCP | `ip-address` | 10.2.0 | 10.4.0 |
| MCP | `js-yaml` | 4.3.0 | 4.3.1 |
| Frontend | `nanoid` | 3.3.16 | 3.3.18 |

`js-yaml` is an exact direct dependency. The other affected transitive paths
are exact overrides. The lockfile diff contains only those six resolutions;
unrelated npm-client platform metadata was retained.

All repository audit gates are zero:

- canonical `npm run audit:dependencies`: frontend, package-owned MCP,
  scaffold parser lock, and development parser lock all report zero;
- the root lockfile audit also reports zero; and
- clean MCP and frontend installs, MCP TypeScript build, and frontend
  TypeScript/Vite build pass. The expected Vite large-chunk warning remains
  informational and unchanged.

## Reproducible Packed Acceptance

`tests/packed-filesystem-containment.test.mjs` is a dedicated acceptance
harness. It is deliberately not part of ordinary `npm test` because it builds
a real package, extracts it, installs it into a clean prefix, installs the
locked packaged parser dependencies, and runs the full containment matrix
against the installed files. It is now exposed as
`npm run release:packed-containment` and is an explicit gate in both Release
Bump and Release Publish, after their locked builds/tests/audits and before
tagging or npm publication. Candidate version expectations come from the
candidate `package.json`, so the final synchronized `2.5.0` artifact will be
tested rather than a hard-coded `2.4.2` value.

Every fixture and npm cache is created below one test-owned operating-system
temporary directory and removed in `finally`. The only repository-local state
the harness varies is the ignored MCP build marker; it backs up and restores
any pre-existing marker.

The harness proves:

- real `npm pack --json`, explicit tar extraction, and clean-prefix install;
- a full sorted `path -> mode` inventory digest, exact entry/mode counts, and
  identical inventory from a marker-free checkout and a checkout containing
  the ignored `.cortex-build-hash`;
- all 93 packaged `scaffold/scripts/` runtime entries exactly equal the
  installed ownership subset, whose complete manifest has 381 unique paths;
- the complete 41-case source/control/prior-cache/output/staging/hard-link/
  dashboard/npm/lifecycle matrix passes against installed canonical modules;
- both development adapters resolve the installed canonical implementation;
- full and changed ingest produce 26 JSONL and 21 TSV outputs with all four
  frozen normalized hashes;
- the full run emits the exact 17 trace labels ending in
  `writes:manifest_complete`, while changed mode preserves its deterministic
  manifest and output contract;
- development dashboard rendering remains a separate adapter result while a
  second four-case run imports the actually installed
  `scaffold/scripts/dashboard.mjs`;
- an offline `git archive` of the verified released tag `v2.4.2` at
  `736becf34d929ea0bef88adbe476a584a1f081e9` initializes the pre-state; the
  candidate force-upgrade then replaces and fingerprints every managed script
  changed since that tag (14 in this iteration, including one new file) while
  preserving user-owned config, ontology, and an unknown script; and
- denial fixtures retain one bounded policy diagnostic, no normal completion,
  zero fake-npm invocation, no sibling-canary read/mutation, complete
  pre-commit preservation, documented commit-prefix behavior, and cleanup of
  every still-owned stage.

Harness result:

| Gate | Result |
|---|---:|
| Packed boundary matrix | 41/41 |
| Packed characterization | 3/3 |
| Development dashboard rendering | 4/4, separate adapter evidence |
| Installed packaged dashboard rendering | 4/4 |
| Owned packaged runtime entries | 93/93 |
| Complete managed ownership | 381/381 unique paths |
| Released-tag upgrade | 14/14 changed scripts and state hashes; 1 new |
| Package entries | 416, marker-free and marker-present equal |
| Modes | 395 at `0644`; 21 at `0755` |
| Sorted path/mode SHA-256 | `c278da28d82a55abb60706b8fb2ad2bf0f77dc35709f4c9fa94056a4226ed5d2` |
| Packed size | 643,952 bytes |
| Unpacked size | 2,720,847 bytes |
| Tarball SHA-1 | `8fd5ecdd48a4b5ff31325c95022f6898413cf0d1` |
| Tarball SHA-256 | `ec8066c5c1d3d22d3fc88e68e707826028dc31aa2b9e33edd140235ab79db1a0` |

The temporary tarball is evidence only and was removed. The full sorted
path/mode digest is the reproducible inventory contract. Because npm tarballs
also include generated metadata, their digests are recorded for this exact run
rather than claimed as byte-reproducible build output.

## Integrated Validation Evidence

- Syntax: both ingest wrappers, both dashboards, the worker, every canonical
  ingest module, and the packed harness pass `node --check`.
- Filesystem boundary: 41/41.
- Frozen characterization/parallel/worker/trace/dashboard group: 19/19.
- Frozen outputs remain:
  - full JSONL 26,
    `937102d472623c4d852762ab700ae510bdc30927ee8aec9aa890976e3b4d44fe`;
  - full TSV 21,
    `253278db329ecd74ebce9379a2e406e71841388f37ae2ee4ebf166459df7dd43`;
  - changed JSONL 26,
    `4fe3cf7e15908215863476a53c785c045ea71af75fb3db76ee88b41020276f3f`;
  - changed TSV 21,
    `7e70109126569d4534c340ce6791bb4dc8c295c7db70eb9faf14196beda6c2f4`.
- Context regressions: 81/81.
- Full root suite: 364/364.
- Full package-owned MCP suite: 413/413.
- Frontend production build: passed, 2,267 modules transformed.
- Version synchronization: passed at the current pre-release metadata
  `2.4.2`; the release gates read this dynamically and will repeat after the
  separately authorized version synchronization.
- `git diff --check`: passed.
- Five lockfile audits: zero findings.
- Iteration Cortex update: 51 embedded, 1,195 reused, and 0 failed; resulting
  index has 132 files, 1,095 chunks, and 1,246 entities.
- Indexed `cortex pattern-evidence` found local patterns for all seven changed
  control documents; `cortex doctor` passed 8/8 and the watcher is stopped.

## Release Classification and R16 Recommendation

The combined change intentionally rejects external, parent-relative,
symlinked, redirected, or special-node filesystem layouts that v2.4.2 could
read or mutate. Operators using those unsafe layouts must move to regular,
project-owned portable relative paths. Safe missing contained sources and
safe missing optional dashboard data remain non-fatal.

Changed mode also fixes safe aliases containing repeated `/` or redundant
interior `.` so they now match canonical `src/nested` output. Manifests retain
the configured spelling and file IDs remain canonical. No configuration
migration is needed for that correctness fix.

Because the release combines a material fail-closed behavior change with a
backward-compatible correctness fix and requires an operator migration only
for formerly unsafe configurations, WO-035 classifies it as a semver **minor**
release: `2.5.0`. This document records the classification only; it does not
change version metadata.

All required independent reviewers reproduced the relevant gates without a
remaining blocker, major, or minor finding. The manager therefore closes R16
as mitigated and marks R3 mitigated without a waiver. This acceptance does not
itself change version metadata, integrate WO-046, or perform GitHub/npm release
actions.

## Release-Note Facts for the Later Version Iteration

- Added a real-project filesystem boundary for ingest controls, sources,
  workers, secondary README reads, prior caches, all 48 outputs, dashboard
  data, and dashboard npm cache selection.
- Rejects absolute/parent/backslash/drive/UNC configured sources and symlinked
  or special control/source/cache/output/dashboard layouts with one bounded,
  non-disclosing diagnostic.
- Stages the complete 48-file output set exclusively, validates the whole set
  before commit, replaces hard-linked destinations without mutating sibling
  links, cleans uncommitted stages, and publishes the manifest last.
- Preserves the four frozen full/changed hashes, 26/21 output counts, worker
  fallback and parallel identity, 17 trace labels, and dashboard rendering.
- Fixes changed-mode matching for repeated-separator and interior-dot safe
  aliases without changing manifest source spellings or file IDs.
- Updates six vulnerable MCP/frontend dependency resolutions; all lockfile
  audits are zero.
- Migration: replace external, parent-relative, backslash/drive/UNC, symlinked,
  redirected, or special-node layouts with regular project-owned paths before
  ingesting. No migration is needed for safe portable relative paths.

## Residual Risks and Review Questions

- Portable Node retains the narrow same-user validation-to-path-syscall
  interval already documented by WO-033/WO-034; no `openat`-style race
  elimination is claimed.
- A commit-phase failure may expose an already replaced deterministic prefix;
  the manifest remains last and all uncommitted stages are removed.
- Reviewers must confirm the exact dependency pins/overrides, release-workflow
  placement, deterministic 416-entry inventory, installed packaged-dashboard
  scope, real released-tag upgrade, and minor-release classification. The
  first-pass blocker/major findings have fix evidence but are not closed until
  re-review.
