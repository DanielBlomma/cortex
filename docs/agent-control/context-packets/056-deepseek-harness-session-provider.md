# WO-057 DeepSeek Harness Session-Scoped Cortex Provider

## Objective

Implement the first installable DeepSeek Harness integration as a native,
session-scoped Cortex provider plus explicit model-facing tools and canonical
Cortex behavior skills. The integration must support concurrent Harness Web
sessions rooted in different repositories without a process-global Cortex
workspace.

This packet supersedes only the blocked V1 MCP-client topology in packet 055.
WO-056 remains the compatibility audit and umbrella plan. Proactive retrieval
remains a later, separately accepted work order.

## Authorized Product Decision

The user selected safe path 3 from WO-056 on 2026-08-27: bring the native
provider boundary forward into V1. Do not mount the official Harness MCP client
for Cortex at the pinned Harness version.

## Frozen Upstream Baseline

- DeepSeek Harness release: `0.1.1-rc.2`
- Commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Compatibility fixture: `tests/fixtures/deepseek-harness-compatibility.json`
- Drift command:

  ```bash
  node scripts/check-deepseek-harness-compatibility.mjs \
    --checkout /path/to/deepseek-harness
  ```

Use exact `0.1.1-rc.2` Harness dependencies. Do not resolve the registry's
default tag.

## Architecture Contract

The bundle is `@danielblomma/dsh-cortex` under `plugins/dsh-cortex/` and
declares `dsh.bundle.patch`. Its patch mounts three internal contributions:

1. `CortexContextService`, exposed as `ctx.cortexContext`, owns Cortex process
   execution and response validation. Every public method requires the exact
   Harness `Agent` plus its request and `AbortSignal`.
2. A tool consumer installs tools through each live `agent.ctx`, never through
   the host-global tools layer. Registrations disappear with the agent scope.
3. A skill consumer installs the canonical Cortex behavior skills through
   each live `agent.ctx`. Packaged skill bodies are generated or copied from
   `plugins/cortex/skills/` and a deterministic test rejects drift.

Use the pinned Harness file-reference service/provider as the lifecycle
pattern and its scoped-tools tests as the isolation oracle. The decisive
upstream contracts are:

- `ToolRunContext.agent` supplies execution identity;
- `agent.session.header.cwd` supplies the immutable workspace selector;
- `agent.ctx.tools.register(...)` creates an agent-only tool layer;
- scoped registration disposal removes visibility and execution authority;
- `agent.ctx.inject(...)` binds dependent contributions to that scope;
- `ctx.subprocess` supplies argv-only execution, bounded collected streams,
  abort-driven process-tree termination, and credential/`DSH_*` environment
  scrubbing.

No model argument, bundle setting, ambient `process.cwd()`, or process-global
singleton may select a repository.

## Workspace Authority

For every provider call:

1. require `agent` identity and a non-empty absolute
   `agent.session.header.cwd`;
2. resolve the cwd with the host filesystem's canonical `realpath` and require
   it to be an existing directory;
3. use that canonical directory as the subprocess `cwd` and as the project
   identity included in diagnostics and future cache keys;
4. reject a missing, relative, deleted, or unresolvable workspace; never fall
   back to `process.cwd()`;
5. re-resolve before each subprocess call rather than trusting a prior string
   cache. Cortex's own repository containment remains the inner enforcement
   boundary.

The provider may retain per-`Agent` readiness state, but V1 must not cache
retrieval results. Agent disposal clears all retained state.

## Cortex Execution Contract

Depend on the exact package-owned `@danielblomma/cortex-mcp` version. Resolve
its exported `bin/cortex.mjs` with package/module resolution and invoke it with
the resolved Node executable:

```text
[process.execPath, <package-owned bin/cortex.mjs>, <command>, ...args, --json]
```

Run through `ctx.subprocess`; do not use a shell, `npx`, `@latest`, a PATH-only
`cortex`, raw Node `spawn`, or private `.context`/`scaffold/mcp/src` imports.
Pass no explicit environment entries in V1. Configure all stdio modes,
collection limits, grace, signal, and caller-owned timeout explicitly.

Initial hard bounds:

- query text: 8 KiB UTF-8;
- provider timeout: 15 seconds;
- termination grace: 1 second;
- stdout: 2 MiB, collected in memory with no spill;
- stderr: 64 KiB, collected in memory with no spill;
- CLI result limits: never exceed each public command's existing maximum.

Aborted, timed-out, truncated, non-zero, malformed-JSON, multi-document, or
schema-invalid output is an error. Never parse a successful payload from
stderr or expose an unbounded diagnostic tail to the model.

## V1 Public Surface

V1 exposes four read-only native tools:

| Harness tool | Cortex CLI contract |
|---|---|
| `cortex_search` | `cortex search ... --json` |
| `cortex_related` | `cortex related ... --json` |
| `cortex_impact` | `cortex impact ... --json` |
| `cortex_rules` | `cortex rules ... --json` |

Tool schemas mirror the public CLI limits in
`scaffold/mcp/src/cli/query.ts`. Provider code validates the common envelope:
one JSON object, expected `command`, boolean `ok`, object `data` on success,
and bounded `{ code, message }` on failure. Consumers render validated Cortex
data; they do not reimplement ranking, traversal, rules, or impact logic.

`context.reload` is intentionally absent. It reloads a long-lived MCP graph,
while the native V1 provider starts a bounded CLI process per call. `cortex
update` is an index mutation and is not equivalent. Adding reload/status/index
generation requires a separately frozen public CLI or library contract.

The old deterministic MCP-normalized names in WO-056 remain compatibility
evidence only and are not public names for this native topology.

## Failure Policy

Configuration includes `required: false` by default.

- `required: false`: the agent remains usable. Cortex tool calls fail with one
  stable, bounded actionable error; no repository content is injected by the
  plugin and no background bootstrap/watch/update starts automatically.
- `required: true`: because workspaces are created after bundle activation,
  strictness is agent-scoped rather than process-global. Before the first model
  step for that agent, validate workspace authority and one read-only Cortex
  readiness query. Reject that agent step with a stable actionable error if
  validation fails. Other agents and workspaces remain unaffected.

This agent-scoped meaning explicitly supersedes packet 055's earlier
process-activation wording, which cannot be correct for a multi-workspace Web
host.

Normalize failures to stable codes covering missing execution identity,
invalid workspace, unavailable runtime, timeout, cancellation, non-zero exit,
output limit, malformed JSON, and protocol/schema mismatch. Include only the
canonical workspace path and bounded remediation text; never echo source
payloads, environment values, or secrets in diagnostics.

## Behavior Skills

Package the existing canonical Cortex skills without changing their workflow
semantics. The Harness-facing copy may adapt command/tool spelling only where
the host requires it. A sync manifest or content hashes must prove every
adapted body derives from `plugins/cortex/skills/`; semantic differences need
an explicit reviewed exception.

Skills are agent-scoped and remain explicit behavior. V1 performs no automatic
retrieval and does not modify `agent/pre-step` except for the `required: true`
readiness guard.

## Implementation Sequence

1. Re-run Cortex search/rules/impact and the pinned Harness 18-file drift
   checker. Record a Contract and Security/Privacy review of this packet before
   runtime files are added.
2. Add the bundle manifest, exact dependencies, build/package layout, Cordis
   patch, and manifest/version-sync tests.
3. Add the service definition and local subprocess provider with unit tests for
   workspace authority, argv, bounds, cancellation, output validation, and
   stable errors.
4. Add per-agent tool lifecycle and a two-repository, one-process isolation
   fixture proving visibility, execution, and teardown boundaries.
5. Add the scoped skill contribution plus deterministic canonical-source drift
   tests.
6. Pack and install the bundle into the pinned Harness Web and headless
   profiles; run discovery, fixture search, removal, cancellation, and negative
   lifecycle tests.
7. Run root/MCP/package/version/audit/diff gates, Cortex pattern evidence on
   every changed indexed file, `cortex update`, and all required independent
   reviews.

## Acceptance Gate

WO-057 is accepted only when:

- two concurrent agents with different indexed roots can see and execute only
  their own scoped Cortex tools and results;
- calls without the exact agent identity or canonical cwd fail closed;
- no public input can select or override a project root;
- abort and timeout terminate the complete Cortex process tree;
- stdout/stderr limits, JSON-envelope validation, and stable error mapping pass;
- package-owned exact-version execution is proven with PATH/npm network
  disabled during retrieval;
- canonical skill synchronization and agent-scope disposal pass;
- packed install, `--dump-config`, Web/headless smoke, upgrade, and removal pass
  on the pinned Harness baseline;
- no retrieval/query/source/session data gains a remote transport or telemetry
  path;
- Contract, Security/Privacy, Integration/Code Quality, and Validation return
  GO, followed by the normal Cortex validation matrix.

Implementation is not publication authorization. README status stays
`planned` until a separately authorized accepted release.

## Non-Scope

- official MCP-client integration at the pinned Harness version;
- proactive `agent/pre-step` retrieval or answer-level experiments;
- Cortex ranking/indexing changes;
- automatic bootstrap, update, watch, or repository initialization;
- cloud retrieval, source upload, remote telemetry, or session export;
- patching DeepSeek Harness core;
- publishing either npm package.

## Fresh-Session Entry Point

Start WO-057 in a fresh session using only this packet and these direct
references:

- `docs/agent-control/wo-056-deepseek-harness-stage0-compatibility.md`
- `tests/fixtures/deepseek-harness-compatibility.json`
- `scripts/check-deepseek-harness-compatibility.mjs`
- `scaffold/mcp/src/cli/query.ts`
- `plugins/cortex/skills/`
- `scripts/sync-release-version.mjs`
- `tests/plugin-manifests.test.mjs`
- `tests/plugin-skills.test.mjs`
- `README.md`

From the verified pinned Harness checkout, inspect only:

- `packages/core/tools/src/index.ts`
- `packages/core/tools/src/schema.ts`
- `packages/core/tools/tests/scoped.spec.ts`
- `packages/core/agent/src/runtime-types.ts`
- `packages/context/file-reference/src/index.ts`
- `packages/context/file-reference-local/src/index.ts`
- `packages/subprocess/subprocess/src/index.ts`
- `packages/subprocess/subprocess/src/types.ts`
- `packages/skill/skill/src/index.ts`
- `packages/skill/tool-skill/src/index.ts`
- `docs/user/develop/basic/publish.md`

Inspect the worktree before editing. Do not inherit conclusions from chat
history; this packet is the complete authority for WO-057.
