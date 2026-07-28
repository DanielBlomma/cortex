# Enterprise Security Boundary Hardening

## Objective

Keep Cortex Enterprise and harden the local trust boundary around remote
organization data, license credentials, secret persistence, and the per-user
daemon's handling of multiple project roots.

## Background

- Review of the 2.4.0 application reproduced a remote skill-name traversal
  that could write outside the managed skills root and later recursively
  delete the escaped directory.
- License cache entries are not bound to the endpoint or API key that produced
  them, so onboarding can accept a different unverified credential.
- `cortex enterprise <api-key>` exposes the key in process arguments and shell
  history, and generated `enterprise.yml` files can remain mode `0644`.
- The daemon is per-user, but several enterprise services and tamper checks are
  pinned to the first process working directory. Shared daemon state must not
  silently apply one project's trust material to another project.
- The user explicitly chose to retain Enterprise and fix these boundaries.

## Work Profile

Infra/deploy/security-sensitive — this changes authentication, secrets,
remote-content persistence, deletion, and enforcement behavior.

## Owned Scope

- `scaffold/mcp/src/daemon/skill-sync-checker.ts`
- `scaffold/mcp/src/core/license.ts`
- `scaffold/mcp/src/cli/enterprise-setup.ts`
- `scaffold/mcp/src/daemon/main.ts`, user-global identity/event storage, and
  the project-service coordinator
- `bin/cortex.mjs` and enterprise CLI help strings
- Focused root and `scaffold/mcp/tests/` regression tests
- Version metadata required for the security patch
- Agent-control acceptance, risk, manager, and handoff records for WO-024

## Out Of Scope

- Removing Enterprise or changing enterprise policy semantics
- Cortex Web/server-side manifest or license implementation
- Community retrieval, parser, embedding, benchmark, and static frontend work
- Hook settings recovery and unrelated scaffold migration findings from the
  application review
- Publishing, tagging, merging, or deploying the release

## Constraints

- Remote identifiers must be treated as untrusted even when returned by the
  configured Cortex endpoint.
- Writes and deletions must be proven contained beneath the intended managed
  root; persisted absolute paths are not deletion authority.
- Legacy unsafe state may be ignored or sanitized but must never trigger an
  out-of-root filesystem mutation.
- License cache reuse requires the same normalized endpoint and a one-way API
  key fingerprint. Raw keys must never enter cache or logs.
- Authentication rejection must not enter the endpoint-unreachable grace path.
- API keys must not be accepted as positional process arguments. Noninteractive
  onboarding uses stdin.
- Enterprise configuration replacement must be atomic and mode `0600`,
  including when replacing an existing permissive file.
- A per-user daemon must route project-specific services and tamper checks by
  heartbeat cwd without sharing project credentials or project-local caches.
  Host-global services require one verified durable identity; unattributed
  process events use a credential-bound user-global queue.
- Privileged Enterprise commands load only package-owned code. Project-local
  reads and writes execute with the sudo target user's effective identity, and
  cached govern paths are never root mutation authority.
- Preserve current supported CLI targets and enterprise behavior for valid
  inputs.

## Known Failure Modes Checklist

- Invalid, duplicate, traversal, absolute, separator-bearing, dot, and symlink
  skill targets are denied before body fetch or filesystem mutation.
- Removal derives its target from a validated CLI/name pair and does not trust
  `record.path`.
- License tests cover key mismatch, endpoint mismatch, legacy cache entries,
  authentication rejection, transient grace, and successful matching reuse.
- Secret tests prove no positional-key onboarding, stdin handling, and final
  `0600` mode for new and pre-existing configuration.
- Multi-project tests prove separate roots receive their own services and
  tamper evaluation while host-global services start once for the verified
  identity.
- Explicit same-endpoint key rotation purges marker-owned skills and clears
  credential caches before rebinding. Legacy unmarked skills require a
  deliberate operator backup/reconciliation step.
- Errors and audit metadata never include API-key values.
- Focused tests include denied and malformed cases, not only happy paths.

## Required Output

- Hardened runtime and CLI behavior.
- Focused negative regression tests for every reproduced security failure.
- Full root and MCP test results.
- Updated Cortex index and clean-diff/version-sync evidence.
- Closed or explicitly deferred risk-register entries and review findings.

## Acceptance

- The traversal/deletion reproduction cannot write or delete outside either
  CLI's managed skills root.
- A valid cache for credential A is never accepted for credential B or another
  endpoint.
- HTTP 401/403 invalidates authorization without grace fallback.
- Enterprise API keys do not appear in supported CLI argv and generated config
  is mode `0600`.
- Project-specific daemon services are registered by normalized project cwd,
  host-global services are bound to one durable identity, and unattributed
  process metadata never enters a project audit boundary.
- Security, validation, and release checks pass with no unresolved blocker or
  major review finding.

## Outcome

Accepted locally on 2026-07-28 for 2.4.1. Security and Ops/Release reviews
reported no blocker or major findings after iterative fixes. Validation's only
remaining finding is a deferred minor integration-test gap between heartbeat
routing and the project-service registry; the registry, heartbeat, identity,
and multi-project boundaries are covered independently and both full suites
pass. Final evidence is recorded in the manager log and handoff ledger.
