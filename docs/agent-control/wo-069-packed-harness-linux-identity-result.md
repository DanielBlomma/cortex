# WO-069 Packed Harness Linux Identity Remediation Result

Date: 2026-08-31

## Outcome

WO-069 produced one clean local candidate that fixes only the Linux identity
boundary in the packed Harness release gate. The candidate remains committed
at `2.5.2`, changes no workflow, runtime, provider, bundle behavior, OIDC
configuration, secret/trusted-publisher state, README/CHANGELOG, tag, or
registry surface, and was not pushed.

- Candidate branch: `release/packed-harness-linux-identity`
- Exact base: `a3dc1aa1ec005d28e010fe0c2c0ac159390e488c`
- Base tree: `56cdab23e37eaf034facb32a9e4c48cd712a43be`
- Reviewer must resolve and record the final candidate HEAD/tree from the clean
  branch rather than trusting a self-referential document value.
- Candidate paths:
  - `package.json`
  - `scripts/release-artifacts.mjs`
  - `tests/release-harness-identity.test.mjs`
  - this result record

## Reproduced Cause Before Editing

The accepted Release Bump command was reproduced in a native Ubuntu Noble
arm64 container running exact Node `22.23.2`, npm `11.19.1`, and .NET
`8.0.424`. The Actions-like caller was numeric uid/gid `1001/1001`; the
container granted passwordless `sudo` only for `/usr/bin/unshare`.

Before the gate, the disposable output root and `dsh-home` were both owned by
`1001/1001` at mode `0755`. The existing command

```text
sudo -n /usr/bin/unshare --net -- /usr/bin/env ... <Harness gate>
```

executed the child as exact uid/gid `0/0`. Creating the Harness-equivalent
`dsh-home/sessions` root at mode `0700` therefore left it owned by `0/0`.
The original `1001/1001` process then failed exact
`EACCES: permission denied, scandir .../dsh-home/sessions`, matching job
`99481173677`. Git blame places the Linux command in release-gate commit
`afe6eb1a`; it is not a Cortex runtime or accepted V1 provider regression.

## Narrow Remediation

`runNetworkDenied` now requires `/usr/bin/setpriv`, resolves the invoking
numeric uid/gid, and rejects root or unresolved Linux callers. The privileged
outer process still creates the network namespace, then runs the gate through:

```text
setpriv --reuid=<caller> --regid=<caller> --clear-groups
        --no-new-privs --bounding-set=-all
```

Only the explicit `HOME`, `DSH_HOME`, telemetry-off flag,
`CORTEX_RELEASE_NETWORK_DENIED=1`, and `PATH=/nonexistent` cross the boundary.
No auth variable is forwarded. There is no `chmod`, `chown`, recursive
permission repair, world-writable mode, session deletion/recreation, root Web
process, retry, bypass, or workflow reorder. The macOS `sandbox-exec` branch is
unchanged.

The new focused test is included in `release:test`, which runs on Linux before
the packed Harness gate. It is intentionally not added to the locked root
`npm test` list, preserving exact root total `417/417`.

## Validation Evidence

### Linux identity and network boundary

Native Ubuntu Noble arm64 direct test: **2/2 pass, zero skips**.

- child uid/gid remained exact `1001/1001`;
- `CapEff` was all zero and `NoNewPrivs` was `1`;
- external `fetch` failed inside the isolated network namespace;
- `PATH`, home/session roots, telemetry flag, and boundary attestation were
  exact;
- sentinel `NODE_AUTH_TOKEN` and `NPM_TOKEN` values did not reach the child;
- `sessions` was owned by `1001/1001`, mode `0700`, and was scannable both
  inside the gate and by the following ordinary caller;
- the source-negative rejects missing `setpriv`, root callers, absent numeric
  drop flags, or any chmod/chown workaround.

The same test passes statically on macOS with the Linux process case explicitly
skipped.

### Existing committed `2.5.2` gates

- focused release: 42 tests, 41 pass, 1 platform skip;
- version synchronization: exact `2.5.2`;
- context: `81/81`;
- root: `417/417` with zero skips after moving the new test out of the locked
  root list;
- bundle: `6/6`;
- MCP: `426/426`;
- all six dependency audits: zero vulnerabilities;
- `git diff --check`: pass;
- Cortex update: 1,557/1,557 semantic entities, zero failures;
- Cortex pattern evidence: repo-local evidence found for
  `scripts/release-artifacts.mjs`; tests are excluded by the configured Cortex
  source paths, so the new test cannot be a file target and is reviewed
  directly.

### Disposable exact `2.6.0` artifact simulation

A `--no-local --no-hardlinks` clone of preliminary implementation commit
`75506412f6cfd1df0924f1c8abed68838310bcec` was bumped only in disposable
state. Its mutation set was the existing exact eight release metadata paths.

- focused release: same 42/41/1 result with expected version `2.6.0`;
- packed containment: 420 entries, 399 at `0644`, 21 at `0755`, 41 boundary
  cases, 3 characterization cases, development/packed dashboard `4/4`, exact
  inventory SHA-256
  `cebf97a2b13ef48733d79b97b0c7785d3152915e0b5ab6706190a836e38b48bd`;
- duplicate root artifacts were byte-identical at SHA-256
  `779663313418918e9c7f0af0416c90e9e4c2aca2ac322b7a7cc2e4f7e1087a7f`;
- duplicate bundle artifacts were byte-identical at SHA-256
  `dfe7b922a72868ee3847adedfac18ac806d883610410aa30ad8ba2fa49c8d0a5`;
- empty-cache local install reported CLI/project version exact `2.6.0`;
- pinned Harness commit
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` passed all 18 compatibility
  files.

The canonical `/private/tmp` macOS packed lifecycle passed fully: two
profiles, three Cortex rows per profile, four exact tools, five byte-identical
skills, two isolated indexed roots, real search/rules/related/impact, all four
negative cases, complete disposal, Web HTTP `200` with 14,522 bytes,
controlled shutdown, and profile removal.

Two prior macOS attempts used the noncanonical `/tmp` alias. Node resolved the
same checkout to `/private/tmp`, so the existing index-lock identity treated
the roots differently and ingest returned before producing its cache. Both
stopped before the changed Linux boundary. They are retained as invalid
path-alias evidence, not counted as passing runs and not used to authorize a
fix. The canonical run is the controlling macOS evidence.

An extra Ubuntu Noble `linux/amd64` run under arm64 emulation exercised the
complete fixed path. It passed profile installation, the network-denied
headless gate, session scan, and Web port binding with no `EACCES`. It then
failed only because emulation did not complete the unchanged controlled Web
shutdown within the fixed 10-second limit. This is recorded as a native-x64
timing limitation and is not called green; the direct native Linux boundary
test and complete native macOS lifecycle are green. A native GitHub x64 run
remains mandatory before merge or release authority.

## External State

Final read-only checks found no remote `v2.6.0` tag, no GitHub Release, no root
npm `2.6.0`, no bundle package/version, and no `v2.6.0` Publish run. Root npm
`latest` remains exact `2.5.2`. Failed Bump runs `33365807103` and
`33389989562` remain terminal and were not rerun.

## Handoff

The candidate is ready only for fresh independent read-only review. The
reviewer must reproduce the native Linux identity/network/ownership test,
inspect the exact numeric drop and capability removal, verify unchanged
workflow/root-only/bundle boundaries, and treat the emulated shutdown timeout
as an explicit limitation. This result does not authorize push, PR, merge,
Release Bump, tag, GitHub Release, npm publication, bundle publication, or V2.
