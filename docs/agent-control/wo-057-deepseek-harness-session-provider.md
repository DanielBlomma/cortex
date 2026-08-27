# WO-057 DeepSeek Harness Session-Scoped Provider Decision

## Decision

Proceed with the revised V1 architecture from WO-056 safe path 3. The first
DeepSeek Harness bundle will use a native `ctx.cortexContext` provider and
agent-scoped tool/skill consumers. It will not mount the official Harness MCP
client for Cortex on the pinned baseline.

User authorization was received on 2026-08-27. Runtime implementation has not
started because the repository requires a new work order to begin in a fresh
session, and the new contract still requires independent Contract and
Security/Privacy review.

Implementation packet:
`docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`.

## Why This Topology Is Safe To Implement

Pinned Harness `0.1.1-rc.2` supplies two authorities that the official MCP
client does not combine:

1. every native tool execution carries its calling `Agent` in
   `ToolRunContext.agent`; and
2. tools registered through `agent.ctx` are visible and executable only for
   that agent scope, then disappear with scope disposal.

The local file-reference provider independently demonstrates the matching
service pattern: provider methods receive `Agent`, derive the workspace from
`agent.session.header.cwd`, retain per-agent state, install scope-dependent
behavior through `agent.ctx.inject(...)`, and clean up on `agent/disposed`.

Harness `ctx.subprocess` provides the remaining process boundary: exact argv
without shell interpretation, explicit cwd/stdin/stdout/stderr/grace, bounded
collection, abort-driven process-tree termination, and ambient credential plus
`DSH_*` environment scrubbing.

Together these contracts allow one process to serve concurrent Web sessions
without a process-global Cortex root.

## Material Changes From The Original V1

- The native provider boundary moves from V2 into V1.
- Repository authority comes only from the calling `Agent`; no model-facing
  or static project-root setting exists.
- Four native read-only tools replace the five MCP-normalized names:
  `cortex_search`, `cortex_related`, `cortex_impact`, and `cortex_rules`.
- `context.reload` is not emulated because a per-call CLI provider has no
  long-lived MCP graph to reload, and `cortex update` is a different mutating
  operation.
- `required: true` is enforced per agent before its first model step, not by
  blocking the process-wide bundle activation.
- V1 uses the public Cortex CLI JSON query envelope. It does not import private
  retrieval modules or duplicate ranking logic.
- Proactive retrieval is still deferred to a later work order and now reuses
  the V1 service rather than introducing it.

## Open Review Gate

Contract review must verify CLI-envelope parity, the four-tool surface, and
the revised agent-scoped `required` semantics. Security/Privacy review must
verify workspace authority, canonicalization, subprocess/environment bounds,
diagnostic redaction, and the two-repository isolation test design.

Until both reviews are recorded as GO, `plugins/dsh-cortex/` remains absent.
This decision record and packet are architecture/control changes only.

## Status Update — 2026-08-27

Both pre-implementation reviews returned GO and the locally validated
implementation candidate now exists. See
`docs/agent-control/wo-057-deepseek-harness-contract-security-review.md` and
`docs/agent-control/wo-057-deepseek-harness-session-provider-result.md`.
Independent final acceptance and publication remain outstanding.
