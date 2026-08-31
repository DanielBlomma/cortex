# WO-068 Release Fresh-Checkout CI Diagnostic Result

Date: 2026-08-31

## Outcome

WO068-IR-001, WO068-IR-002, and WO068-IR-003 are closed. No finding outside
those three was changed. The executable release gate remains in the existing
workflow order, runs once, fails closed, does not infer its expected version,
does not retry, and stops before MCP when the root phase fails.

The final clean canonical `/private/tmp` no-hardlink/no-local validation passed
the exact post-sync `2.6.0` workflow, including prepared and real fresh-checkout
context `81/81`, root `417/417`, included Harness bundle `6/6`, and MCP
`426/426`. Seven dependency audits reported zero vulnerabilities. Packed
containment, deterministic artifacts, empty-cache installation, pinned Harness
compatibility, and the packed Harness lifecycle also passed.

## Candidate identity and containment

- Branch: `release/fresh-checkout-ci-diagnostic`.
- Exact base: `c09a4838bba8ceacd639cfbfe261ba6ce60b549b`.
- Exact base tree: `a05c6e09d1b3b44f06bbe7d40b7a105a0a94b527`.
- Remediation validation commit: `a095b7ba52b0d17c906f63e5b111fcde568c4ef1`.
- Remediation validation tree: `4a5fc2506db1dede9288c5b4d2d22e9b9d9a9b1f`.
- Committed package metadata remains `2.5.2`; `2.6.0` exists only in disposable
  workflow simulations.
- The candidate remains one commit over the exact base. The final amended
  commit/tree are reported separately after this record is committed, because
  a commit cannot truthfully contain its own object ID.
- Changed paths are exactly `.github/workflows/release-bump.yml`,
  `.github/workflows/release-publish.yml`, `package.json`,
  `scripts/release-fresh-checkout.mjs`,
  `tests/release-fresh-checkout.test.mjs`,
  `tests/release-workflows.test.mjs`, and this result record.
- No lockfile, release version, runtime, timeout, V1/V2, provider, bundle,
  registry, publication, or asserted suite-total change was made. No push, PR,
  dispatch, tag, release, publish, login, secret, or trusted-publisher action
  was performed.

## Finding closures

### WO068-IR-001 — exact workflow expected-version mappings

The Bump workflow fresh-checkout step now has the exact step environment
mapping `CORTEX_EXPECTED_RELEASE_VERSION: ${{ env.RELEASE_VERSION }}`. The
Publish workflow uses the exact mapping
`CORTEX_EXPECTED_RELEASE_VERSION: ${{ steps.version.outputs.value }}`.

The workflow validator requires exactly one correct mapping inside that step's
`env` block, before its `run` block. Executable mutation tests reject helper
removal, direct `npm test`, fail-open bypass, movement after audit, a missing
mapping, a drifted mapping, an inline shell-assignment bypass, and a mapping
placed after the helper command in both workflows. Existing preparation,
helper, audit, and publication order is unchanged.

### WO068-IR-002 — truthful bounded streaming accounting

The asynchronous collector now keeps only the combined first 64 MiB of child
output while continuing to observe both streams through child close after it
sends the existing termination signal at the limit. Per channel it records
the full observed byte count, line count, and SHA-256 separately from a
`storedPrefix` byte count, line count, and SHA-256. `captureTruncated` states
whether the stored prefix is incomplete; `unknown`/`unavailable` is used only
when accounting genuinely was not supplied, such as a synthetic collector
failure. Output-limit evidence also records full observed and stored byte
totals.

The executable overflow regression generates 70 one-MiB newline-terminated
chunks (73,400,320 bytes, 70 lines) from a real child that traps `SIGTERM`. It
verifies the full observed totals and independently generated digest, the
67,108,864-byte/64-line stored prefix and its independent digest, truncation,
and bounded emission. Thus the test covers bytes received after the cap and
termination request rather than only a synthetic result.

### WO068-IR-003 — bounded cross-channel event order

The collector assigns a monotonic sequence to every observed stdout/stderr
data event, hashes the complete ordered event stream, and retains a ring of at
most 32 events. Each retained event contains provenance, sequence, byte count,
digest, and a sanitized excerpt capped at 256 bytes/four lines. The final
diagnostic shrink path retains at most the last eight events if needed. This
preserves bounded evidence of observed ordering without concatenating or
leaking raw streams.

An executable child alternates stdout/stderr four times with explicit 25 ms
separation and exits nonzero. Its diagnostic proves sequences `[0,1,2,3]`,
provenance `[stdout,stderr,stdout,stderr]`, the four matching excerpts, a full
order digest, and the child/helper emission caps.

## Diagnostic contract and caps

- Stored child-output prefix: 64 MiB combined; observation and hashing continue
  through child termination/close.
- Per-child diagnostic: less than 64 KiB.
- Total helper emission: less than 256 KiB.
- Per-channel excerpt: 8 KiB and 80 lines.
- Failure extraction: 32 KiB and 240 lines per failure, at most eight failures.
- Retained final-total lines: at most 64.
- Event-order evidence: last 32 observed events; 256 bytes/four lines per event;
  final emergency shrink to the last eight.

ANSI/control data, token-shaped values, npm/GitHub auth names or assignments,
disposable paths, and repository paths in captured evidence are sanitized.
Exact command and cwd remain explicit contract fields. Diagnostics distinguish
nonzero exit, signal, spawn error, collector failure, output limit, missing or
malformed TAP, and exact-total drift. The unchanged success contract is one
envelope per child followed by
`{"ok":true,"context":"81/81","root":"417/417","deepseekHarnessBundle":"6/6","mcp":"426/426"}`.

## Focused, direct, and Linux validation

- JavaScript syntax checks passed.
- Direct helper plus workflow tests passed `29/29`.
- `CORTEX_EXPECTED_RELEASE_VERSION=2.5.2 npm run release:test` passed `40/40`
  at committed state.
- Output/status/signal/spawn/collector/TAP/total-drift/precondition negatives,
  sanitization/redaction, caps, root-before-MCP termination, actual 70 MiB
  overflow, and executable alternating-channel order all passed.
- Native `linux/arm64`, immutable Ubuntu Noble image manifest
  `sha256:7b7dd2f1dc8de17eb242460a672462302b1ba18a0a30e43784538bfd2aeae16d`,
  exact Node `22.23.2`/npm `11.19.1`, non-root UID 501 at
  `/home/runner/work/cortex/cortex`, read-only candidate mount: direct `16/16`
  and focused `40/40` passed.
- Emulated `linux/amd64`, immutable Ubuntu Noble image manifest
  `sha256:be0e90ec8b967fb05cdc1c7243928fc814e2d67fb777808d84f831cba171a91e`,
  with the same toolchain/path/UID/read-only conditions: direct `16/16` and
  focused `40/40` passed.
- Native Linux full/fresh execution remains unavailable because the dependency
  named `ryujs-linux-arm64.node` contains x86-64 ELF machine bytes; amd64 full
  execution is not used as a timing oracle under OrbStack emulation. This known
  platform limitation did not block the direct/focused finding evidence.

## Canonical macOS workflow evidence

Both attempts cloned exact remediation validation commit/tree using
`git clone --no-hardlinks --no-local` under `/private/tmp`, had no object
alternates, began clean at committed `2.5.2`, used Node `22.23.2`, npm
`11.19.1`, .NET `8.0.422`, an isolated npm cache and empty user config, and
unset npm/GitHub credential variables. Both performed all six installs, build,
minor version bump, exact eight-path `2.6.0` synchronization, and local-root
bundle binding before tests. The synchronized paths were:

1. `.claude-plugin/marketplace.json`
2. `package-lock.json`
3. `package.json`
4. `plugins/cortex/.claude-plugin/plugin.json`
5. `plugins/cortex/.codex-plugin/plugin.json`
6. `plugins/dsh-cortex/package-lock.json`
7. `plugins/dsh-cortex/package.json`
8. `server.json`

Attempt one, `/private/tmp/cortex-wo068-remediation.ft4QCH`, passed focused
`40/40`, prepared root `81/417/6`, and prepared MCP `426`. During the real
fresh root phase an unchanged context regression encountered macOS
`ENOTEMPTY` while removing a disposable nested npm-cache temp directory. The
helper truthfully returned nonzero status 1 with bounded sanitized evidence:
stdout 7,114 bytes/138 lines, stderr 896 bytes/22 lines, and 66 observed/32
retained ordered events. MCP correctly did not run. This attempt was preserved
without retry at 4,430 lines/188,823 bytes, SHA-256
`12752b2a0afd60fab2d45f27253d9bd81341c9d4d01bdbe3bf3e321e9857dedf`.

The manager then durably authorized exactly one clean local repeat in packet
amendment commit `51fd48369ae2169a926843448a959a35ab1f0007` and forbade any underlying
test change, relaxation, or further retry. That single repeat,
`/private/tmp/cortex-wo068-repeat.dKq2fz`, cleared the unchanged cleanup race
and passed:

- focused release tests: `40/40`;
- prepared full: context `81/81`, root `417/417`, bundle `6/6`;
- prepared MCP: `426/426`;
- real executable fresh checkout with the explicit expected-version env:
  `81/81`, `417/417`, `6/6`, `426/426`;
- root child evidence: 94,079 observed/stored stdout bytes, 2,702 lines,
  matching full/prefix SHA-256, bounded 2,177-byte/79-line excerpt;
- MCP child evidence: 65,567 observed/stored stdout bytes, 1,050 lines,
  matching full/prefix SHA-256, bounded 6,062-byte/79-line excerpt;
- all seven dependency audits: zero vulnerabilities;
- final version-sync and `git diff --check` gates.

The final repeat log is 6,322 lines/287,767 bytes at
`/private/tmp/cortex-wo068-repeat.dKq2fz/workflow.log`, SHA-256
`aa77d662ab65ae68eb2b882cef7fe8fc79a756709297a065b63b4915045f078c`.
Both attempts remain available; there was no third run.

## Packed containment, artifacts, and Harness

- Packed containment passed: 420 entries; inventory SHA-256
  `cebf97a2b13ef48733d79b97b0c7785d3152915e0b5ab6706190a836e38b48bd`;
  41 boundary, 3 characterization, 4 development-dashboard, and 4
  packed-dashboard cases; clean/prebuilt inventories equal.
- Pinned DeepSeek Harness commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` passed the 18-file
  compatibility check.
- Deterministic root artifacts matched at 676,671 bytes, SHA-256
  `9aaadfeb18b5fe2e78490d4d24b59cbbbb1dcff2f28c61ea66c48d971038b274`.
- Deterministic bundle artifacts matched at 10,260 bytes, SHA-256
  `dfe7b922a72868ee3847adedfac18ac806d883610410aa30ad8ba2fa49c8d0a5`.
- Empty-cache install reported package and CLI version `2.6.0`.
- Packed Harness lifecycle passed two profiles with three rows each; four
  tools, five byte-identical skills, package-owned CLI, denied outbound
  network, PATH isolation, two isolated indexed roots, search/rules/related/
  impact, timeout/cancellation/malformed/oversized negatives, profile/bundle
  disposal, web shutdown, and profile removal were all verified.

## Cortex and final integrity

Cortex search, rules, and impact were run before remediation. Pattern evidence
was attempted on all seven changed paths. The updated result record passed and
returned `diagnosticEnvelope` and `childEvidence` as repository-wide evidence.
The helper target retained the known CLI error `aliases is not iterable`; the
workflow, package, and test paths are outside configured `source_paths` and
reported not indexed. These are recorded tool/index visibility limitations,
not invented pattern coverage.

`cortex update` completed at the committed remediation tree, embedded 48
entities, reused 1,509, failed zero, and rebuilt the 160-file/1,378-chunk graph
with 1,557/1,557 semantic coverage. Final `cortex doctor` passed `8/8` at 100%
freshness; background watch was stopped.

Final JavaScript syntax, controlled JSON and YAML parsing, diff whitespace,
exact seven-path allow-list, committed `2.5.2`, no forbidden lock/runtime/
timeout/version changes, and redaction-fixture-aware secret scanning passed.
The final focused suite and one-commit/clean-state checks are repeated after
the result amendment; exact final commit/tree identity is reported outside the
commit to avoid a self-referential hash.
