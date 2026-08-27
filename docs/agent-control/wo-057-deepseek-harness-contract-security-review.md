# WO-057 Contract and Security/Privacy Pre-Implementation Review

**Date:** 2026-08-27

**Packet:** `docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`

**Harness pin:** `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`

## Evidence

- The repository compatibility checker verified all 18 frozen upstream files
  against the pinned Harness checkout.
- `ToolRunContext.agent` is the execution identity supplied by the agent loop.
- `agent.session.header.cwd` is the session workspace selector.
- `agent.ctx.tools.register(...)` contributes visibility and execution
  authority only to that agent scope and unwinds on scoped disposal.
- `agent.ctx.inject(...)` is the established pattern for mounting
  agent-lifetime contributions.
- `ctx.skills.register(...)` files runtime skills into the calling context's
  scope and invalidates the scoped catalog on disposal.
- `ctx.subprocess` accepts argv without a shell, explicit cwd/stdio/bounds,
  caller cancellation, and tree-scoped termination. Its ambient environment
  removes credential-shaped and `DSH_*` entries before spawning.
- Cortex exposes the four authorized commands through one package-owned CLI
  entry and a common JSON envelope.

Commands:

```text
cortex search "WO-057 session-scoped Cortex provider Agent ctx tools subprocess workspace isolation" --json
cortex rules --json
cortex impact "file:docs/agent-control/context-packets/056-deepseek-harness-session-provider.md" --json
node scripts/check-deepseek-harness-compatibility.mjs --checkout /private/tmp/cortex-wo057-harness-20260827
```

## Contract Review: GO

The packet defines one owner for each boundary: Harness owns agent identity,
scope, lifecycle, cancellation, and managed process execution; the provider
owns canonical workspace resolution, exact Cortex entry resolution, bounded
execution, envelope validation, and stable failures; tools and skills are
agent-scoped consumers. The public V1 surface is limited to four read-only
operations and has no project-root argument.

Implementation must preserve these reviewed invariants:

1. Tool execution requires object identity equality with the agent whose scope
   registered the tool; an absent or substituted `exec.agent` fails closed.
2. Every provider call re-resolves the exact agent's absolute existing cwd by
   `realpath`; no ambient cwd or configuration value is a fallback.
3. Tool parameters mirror the CLI grammar and maxima, and no tool parameter or
   bundle setting can select a root or executable.
4. The package resolves Cortex through the exact direct dependency's exported
   entry, invokes it with `process.execPath`, and never uses PATH, `npx`, a
   shell, private runtime imports, or a registry tag.
5. The common CLI envelope, expected command, success data, and bounded error
   object are validated before a consumer receives them.
6. `required: true` rejects only the affected agent's first step; it cannot
   veto unrelated workspaces or process activation.

No contract blocker remains before implementation.

## Security/Privacy Review: GO

The revised architecture closes WO-056's cross-workspace exposure because
both visibility and execution authority are keyed by the exact live Agent.
Repository selection is not model-controlled. Retrieval remains a local child
process operation and adds no network transport, telemetry, source upload, or
session export. The provider supplies no explicit environment entries, so
Harness credentials and `DSH_*` identity are not forwarded by the subprocess
service.

Implementation must prove these reviewed controls with negative tests:

1. Concurrent agents rooted in two repositories cannot discover or execute
   each other's scoped registrations or receive each other's results.
2. Missing, relative, deleted, symlink-rebound, or unresolvable workspaces fail
   before spawn, with no fallback.
3. Missing/substituted agent identity, public root-like arguments, PATH-only
   execution, and shell metacharacters cannot alter execution authority.
4. Caller abort and the 15-second provider deadline terminate the complete
   process tree and await quiescence; no late result can cross into another
   call.
5. stdout and stderr overflow, non-zero exit, malformed/multiple JSON values,
   wrong commands, and invalid envelopes map to bounded stable errors without
   echoing payloads, environment values, or secrets.
6. Agent and plugin disposal remove all registrations and retained readiness
   state. No bootstrap, update, watcher, or background process starts.
7. Retrieval tests run with package-registry/network access and PATH-based
   Cortex discovery disabled.

R20 remains open until these controls and the packed Web/headless lifecycle
gate pass. That residual validation obligation is not a pre-implementation
blocker.

## Decision

Contract: **GO**

Security/Privacy: **GO**

Runtime implementation under packet 056 is authorized. Publication is not.
