# WO-056 DeepSeek Harness Stage 0 Compatibility Review

## Verdict

Stage 0 is a controlled **NO-GO for the planned Web-profile V1 bridge**.
DeepSeek Harness `0.1.1-rc.2` has the required bundle, MCP, skill, tool, and
`agent/pre-step` APIs, but its official MCP client is one process/profile-wide
plugin instance with a static `cwd` and host-global tool registrations. The Web
host supports multiple concurrent workspaces whose authoritative identity is
each session's immutable `agent.session.header.cwd`.

A global Cortex MCP process rooted at one configured directory would therefore
be visible to sessions belonging to other workspaces. That violates REQ-19 and
R20's no-cross-project contract. Runtime implementation must not start on that
topology.

## Exact Pin

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Commit date: `2026-08-21T20:03:37+08:00`
- Harness release: `0.1.1-rc.2` from npm tag `next`
- Node: `^22.19.0 || >=24.0.0`
- Package manager: `pnpm@11.7.0`
- Cordis: `4.0.1`
- MCP client, skill registry, skill consumer, tools, and agent packages:
  `0.1.1-rc.2`

The complete machine-readable pin and 18 upstream file hashes are in
`tests/fixtures/deepseek-harness-compatibility.json`. Verify any supplied
checkout with:

```bash
node scripts/check-deepseek-harness-compatibility.mjs \
  --checkout /path/to/deepseek-harness
```

The component packages are published under npm tag `next`, while several keep
older versions on `latest`. Any future package must use exact versions and must
not depend on the registry's default tag.

## Frozen Tool Mapping

With `serverName: cortex`, Harness replaces the dot in each Cortex MCP name and
adds the deterministic identity hash required when normalization changes a
name.

| Cortex MCP name | Harness model-facing name |
|---|---|
| `context.search` | `mcp__cortex__context_search_a8d245956d31` |
| `context.get_related` | `mcp__cortex__context_get_related_2d54136df8a0` |
| `context.impact` | `mcp__cortex__context_impact_8a35fa4ccf18` |
| `context.get_rules` | `mcp__cortex__context_get_rules_5ff454152fe4` |
| `context.reload` | `mcp__cortex__context_reload_bc5bfe813469` |

## Contracts That Pass

- The installable package contract is `dsh.bundle.patch`.
- The official MCP client supports stdio, per-call cancellation and timeout,
  deterministic tool names, hot-unload, and strict initial activation through
  `failOnStartupError`.
- `ctx.skills.registerProvider` is the supported provider seam; discovery is
  cwd-aware and accepts an abort signal.
- `agent/pre-step` is a waterfall over the exact claimed message batch and turn
  abort signal, which remains suitable for V2.
- Harness session history is append-only. Model-visible Cortex tool results or
  later proactive evidence are retained locally in that session history and
  must be documented as such.
- Core Cortex retrieval remains local. Package installation may access npm;
  retrieval, query text, source, index, and session data must not gain a remote
  transport or telemetry path.

## Blocking Contract

The pinned official MCP client reads `config.cwd` once when creating its stdio
transport and registers the discovered tools in the host-global tools layer.
It does not receive the calling agent's session cwd when selecting or spawning
the server. Harness Web workspaces, by contrast, are per-session and one host
can concurrently serve different canonical repository roots.

Consequences:

1. Static `cwd: process.cwd()` is not the active Web workspace.
2. A Cortex tool exposed globally can query the wrong repository even when the
   calling session has a different immutable workspace.
3. A skill's cwd-aware discovery cannot repair the authority of an already
   global MCP process.
4. Setting `required: true` only makes startup strict; it does not make the
   server workspace-scoped.

## Safe Paths Forward

Stage 0 identified three safe paths:

1. **Single-workspace V1:** support only a headless/TUI/Python process whose one
   immutable session workspace equals the Cortex MCP root, and explicitly
   exclude the multi-workspace Web profile.
2. **Wait for Harness workspace-scoped MCP:** retain the original V1 design but
   start it only after the official client can bind process/tool lifetime and
   visibility to `agent.session.header.cwd`.
3. **Revise V1 architecture:** build a session-scoped Cortex service/tool
   consumer using the calling agent identity, effectively bringing the native
   provider boundary forward from V2. This is a material plan change and needs
   a new bounded packet before implementation.

No Cortex runtime, plugin bundle, package metadata, publication, or release
state changed in this review.

## Decision Follow-Up (2026-08-27)

The user selected path 3. WO-057 brings the native provider boundary forward
and freezes agent identity, canonical workspace resolution, scoped tools and
skills, managed subprocess execution, CLI JSON validation, and agent-scoped
failure semantics in
`docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`.

The NO-GO remains in force for the official process-global MCP-client topology.
Runtime work begins only in a fresh WO-057 session after Contract and
Security/Privacy GO.
