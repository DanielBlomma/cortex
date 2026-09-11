# WO-LOCAL-004 independent Security / Contract / Code Quality review

Reviewer: `/root/release_completion_manager/security_contract`, assigned before
implementation. Date: 2026-09-11. Independent clone:
`/private/tmp/cortex-local-004-security.yviHNJ/repo`.
Reviewed candidate: `52bd6751e4e512c08a91ec533d623201a707eb40`.
Baseline: `51a276723999cd48ca082fba7f66ae29148b653a`.

## Disposition

Approve the minimal dependency patch's source, supply-chain identity, compatibility
scope and code quality. This is not an assertion that all release gates passed or
that extraction is race-proof. Manager/Ops own six-lock audit, native runtime,
artifact, Linux and release acceptance evidence. Existing upstream tests passed as
recorded below; no newly constructed exploit or bypass code was run by this reviewer.

## Exact candidate and compatibility

Only `scaffold/mcp/package-lock.json` changes: the adm-zip version, registry URL
and integrity move from 0.6.0 to 0.6.1. Independent parsed-lock comparison finds
exactly one changed package object and no manifest changes. Existing override
`adm-zip: ^0.6.0` already authorizes this patch resolution. The underlying ONNX
1.24.3 manifest requests ^0.5.16; this was already overridden before this change.
Transformers stays 4.2.0, its nested ONNX stays 1.24.3, and native dependencies
are unchanged. Public types, entry point, MIT license and Node >=14 engine are
unchanged; Cortex requires Node >=20.9.0. No runtime dependencies or installation
scripts were added to adm-zip. `git diff --check` passes.

## Published package identity and actual source fix

Official npm metadata identifies 0.6.1 with gitHead
`cb2cf9ba4c7c865db426e2de1997cb41194d9872`; the official repository's v0.6.1 tag
points to that commit. Independently downloaded tarball SHA-512 exactly matches:
`sha512-Xwrja8nx9e5o2N1my4DsKCeKpdrnACyr1wtbPxBDgGzKzKyE9kRtBFA8mWldI+RVlD7CBZNWY/wQ2+ydwOR6kQ==`.
All 20 published files byte-match the official checkout at this commit. Both npm
registry signatures verify cryptographically against the current registry key.
This establishes registry/source correspondence; metadata does not include an
OIDC provenance attestation, and none is claimed.

The published patch was committed upstream as `eaa35fa` (ancestor of v0.6.1).
`util/utils.js:169-196` adds `assertPathSafe`, using lstat on every existing path
component strictly below the extraction root and rejecting symbolic links.
Calls precede writes in both file/directory branches of extractEntryTo, synchronous
extractAllTo, and asynchronous directory/file extraction. This implements the
standard pre-existing descendant symlink rejection relevant to the advisory.
It is source proof, not an independent runtime exploit-test result.

The official advisory still lists affected versions 0.5.9 through 0.6.0 and no
patched version, so exclusion from its version range alone is not fix proof.
Upstream PR 575 remains open at `7d90dea2bfd35bc4761d6c8cf822f26b59aeef77`;
0.6.1 contains its own fix and is not represented as that PR's merged outcome.
Sources: [npm 0.6.1 metadata](https://registry.npmjs.org/adm-zip/0.6.1),
[official tagged source](https://github.com/cthackers/adm-zip/tree/cb2cf9ba4c7c865db426e2de1997cb41194d9872),
[advisory](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9),
[upstream PR](https://github.com/cthackers/adm-zip/pull/575).

Other published deltas harden malformed headers, decompression limits/errors,
duplicate names, unsafe permission bits and archive-folder symlink behavior, and
fix folder-promise/Windows path handling. These are compatible security/error-path
changes; intentional rejection of malformed or symlink-dependent inputs is not
claimed to preserve their prior unsafe behavior. Normal ONNX archive compatibility
still requires the manager's installation/native-runtime evidence.

## Residual finding

- Severity: minor for this lock-only update; underlying shared-filesystem risk
  remains security-relevant and can have high integrity impact if its prerequisites
  hold. Area: security. Finding: the guard trusts the extraction root and ancestors,
  skips protection for custom filesystems without lstatSync, and has a pre-check/write
  race because writing is not descriptor-relative or O_NOFOLLOW protected. Evidence:
  published `util/utils.js:169-196` and existing writeFileTo helpers. Official ONNX
  1.24.3 `js/node/script/install-utils.js:142-183` uses a Date.now()-named temporary
  directory, recursive mkdir, and extractEntryTo with overwrite enabled; it does not
  establish a private mkdtemp directory. Required action: retain explicit residual
  risk and avoid describing 0.6.1 as complete protection against hostile concurrent
  mutation or attacker-controlled extraction roots. No blocker introduced or risk
  worsened by the three-field dependency patch was found. Broader installer hardening
  belongs to the upstream/independently scoped supported-installation work.

The normal caller supplies a newly intended extraction directory and selected
NuGet entries; the additional descendant check improves this call without changing
its API. However a shared/reused temporary environment can violate that intended
ownership. Standard private build/install environments reduce that exposure; this
review does not infer filesystem ownership guarantees merely from the directory name.
Official caller reference:
[ONNX 1.24.3 installer](https://github.com/microsoft/onnxruntime/blob/v1.24.3/js/node/script/install-utils.js#L142-L186).

## Validation and Cortex limitations

No independent exploit matrix was completed. Initial source investigation was
followed by manager direction to provide defensive review without new exploit or
bypass code. This report intentionally does not claim a behavioral negative test
for the advisory. Upstream regression results are recorded in the addendum below.

Repo skills: using-cortex, change-impact, pattern-review, context-review. Fresh
lexical ingest and graph load cover only four direct refs (MCP manifest/lock,
release-artifact helper and workflow test). Search, impact, related, six active
rules and lockfile pattern evidence succeed. Search evidence:
`file:scaffold/mcp/package-lock.json`, `file:scaffold/mcp/package.json`.
Guidance returns `INVALID_ARGS: Guidance failed safely`. Initial setup lacked
parser dependencies; copying the local locked parser tree fixed ingest. A copied
runtime outside the ignored context initially exceeded review's 200-path limit;
it was moved out of the repo. Final clean-tree `review --diff` succeeds with zero
changed files, which is not diff-review evidence. Direct exact-commit lock review
and successful rules/pattern fallback are the applicable evidence. Tracked context
configuration is restored. No providers, embeddings, broad index, hooks, remote
writes or changes to other checkouts were performed.

Raw bounded evidence is in the review clone's parent directory: metadata,
registry keys, package tarballs/diff, official upstream clone, PR JSON, caller
source, Cortex logs and upstream test logs.

## Upstream regression addendum and final sign-off

At verified official v0.6.1 / cb2cf9b, `npm ci --ignore-scripts --no-audit --no-fund`
succeeded, then the existing unmodified upstream `npm test` passed 122 tests,
zero failures/pending reported, in approximately 2 seconds on macOS / Node 22.23.2.
All published runtime files used by that checkout are byte-identical to the npm
0.6.1 payload. This provides ordinary upstream compatibility/regression evidence,
including existing invalid-input and recursive-symlink tests. The existing suite
was not found to contain a dedicated regression for the newly added destination
symlink guard; its pass does not supply that missing negative-case evidence.
Development-only dependency deprecation notices from the test install are in the
raw install log and do not change the consumer package's zero-dependency surface.

Final disposition: APPROVE candidate 52bd6751e4e512c08a91ec533d623201a707eb40
for the narrow dependency remediation, carrying the explicit residual finding
and negative-test limitation above. No new blocker or major finding in this diff.
No merge/release GO is implied by this review alone. The manager must preserve
actual validation/CI outcomes and must not claim a complete advisory exploit
matrix or complete extraction-root/race protection.

## Linux diagnostic iteration — lifecycle hypothesis rejected

Ops initially reported missing Ryu native loading with npm 11.19.1 allowScripts
warnings. Independent inspection of the exact installed npm implementation and
its debug log disproves lifecycle blocking: Arborist rebuild skips only policy
results strictly equal to false, and the log records ryugraph install plus ONNX
and protobufjs postinstall completing with code 0. The online npm v11 docs now
say unapproved scripts are blocked by default, contradicting this installed
pinned implementation; the executable source/log controls this diagnosis.
No allow-all flag, lifecycle policy change, npm downgrade or OIDC change is justified.

Ops traced the loader error to an upstream Linux ARM64 packaging problem.
Independent read-only inspection in `cortex-local-004-ops` confirms the running
Node architecture is arm64, while ryugraph 25.9.1's installed `ryujs.node`, its
`prebuilt/ryujs-linux-arm64.node`, and its Linux x64 prebuilt each have ELF machine
62 (x86_64). Files exist; the ARM64-labelled binary has the wrong architecture.
This is an existing upstream artifact limitation, not introduced by the adm-zip
lock patch. It must remain explicit in platform compatibility evidence; it does
not establish a failure on the workflow's Linux x64 runner. Ops is moving the
actual release validation to Linux x64. No source change was reviewed or made
for this diagnostic iteration.

## Cancellation diagnostic iteration — observed zombie reaping race

Ops's Linux x64 emulation with docker-init passed 81 context and 437 root tests,
then one bundle test failed immediate ESRCH after cancellation of a TERM-trapping
descendant whose leader had exited zero. Reviewer used a separate
`/tmp/security-cancel-fixture` in the same container, copying only provider,
protocol and existing integration test; dependencies were read from the existing
locked tree. No Ops source/context/dependency mutation occurred.

An instrumented copy preserved the original assert.throws(process.kill(pid, 0),
/ESRCH/) condition, adding only a read-only /proc stat capture when kill(pid, 0)
succeeded. Eleven targeted invocations produced 10 passes and one reproduction.
At the failing assertion the descendant was a zombie: PID 5688, state Z,
PPID 1, process group 5681. A later independent check confirmed /proc/5688 absent.
This demonstrates an immediate reaping race, not an executing descendant leak
in that reproduction. It does not relabel the original failing gate as passed.

The pinned `@deepseek-ai/dsh-subprocess-local@0.1.1-rc.2` implementation
`lib/index.js:315-338,823-847,915-937` deliberately considers Linux process groups
with only Z/X/x entries exited. Cortex provider correctly awaits handle.waitForExit
before returning CANCELED. The test at local-subprocess-integration.test.mjs:200
additionally requires OS reaping immediately, a stronger timing condition.
No runtime or test assertion was changed. Actual hosted Ubuntu x64 preflight is
pending. If a test-only repair is needed, preserve eventual ESRCH and immediate
rejection of executing descendants, with a bounded wait only for already-dead
process records; do not accept live survivors or unbounded cleanup.

Reproduction command in the reviewer fixture:
`node --test --test-name-pattern="caller cancellation kills a TERM-trapping" tests/cancel-diagnostic.test.mjs`.
Raw logs: `cancel-diagnostic-run1.log`, `cancel-diagnostic-repeats.log` in the
review clone's parent directory. Scoped Cortex index was refreshed for exactly
provider, protocol and the subprocess test; no providers or embeddings.
