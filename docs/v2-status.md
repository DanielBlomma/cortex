# Cortex V2 Status (Locked)

Date locked: 2026-03-01

## Completed Scope

- MCP server uses proper MCP protocol (JSON-RPC over stdio via official SDK).
- Incremental ingest handles changed directory paths and deleted path prefixes correctly.
- Kuzu runtime supports reconnect/reload without server restart.
- Local semantic embeddings are generated with `Xenova/all-MiniLM-L6-v2`.
- `context.search` is unified across `File`, `Rule`, and `ADR`.
- Baseline MCP integration tests are in place and passing.

## Security Risk Acceptance (V2)

Current `npm audit` in `mcp/` reports high vulnerabilities in the dependency chain:

- `kuzu` (direct dependency)
- `cmake-js` (transitive via `kuzu`)
- `tar` (transitive via `cmake-js`)

Status at lock date (`2026-03-01`):

- No fix available in the current upstream `kuzu` release.
- `kuzu` is already on latest available version (`0.11.3`).

Accepted risk decision:

- V2 is accepted with this known risk because the graph layer is required for current retrieval capabilities and there is no upstream patch path right now.

Mitigations in place:

- Repo-local usage by default (no exposed remote MCP service by default setup).
- No automatic execution of downloaded archives in project scripts.
- Keep dependency surface minimal outside required MCP + Kuzu stack.

Operational guardrails:

- Re-run `npm audit` before each release tag.
- Re-check `kuzu` upstream for a patched dependency chain before starting V3 hardening.
- If security posture requirements increase, isolate graph runtime (separate process/container) as first mitigation.

## Remaining Work Moved Out Of V2

- Vulnerability remediation is deferred to V3 (or earlier if upstream releases a fix).
