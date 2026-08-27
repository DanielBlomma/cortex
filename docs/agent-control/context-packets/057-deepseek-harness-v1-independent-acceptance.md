# WO-058 DeepSeek Harness V1 Independent Acceptance Review

## Objective

Perform the independent final review of the WO-057 DeepSeek Harness V1
candidate. Inspect the implementation and reproduce the required evidence;
do not accept the implementer's GO conclusions on authority. Return one
finding-structured report covering Code Quality, Contract, Security/Privacy,
Integration, Validation, and Ops/Release readiness.

This is a read-only runtime review. Do not fix implementation findings, begin
V2, publish packages, open a PR, commit, tag, or alter release state.

## Background

- Candidate worktree: `/Users/danielnilsson/GIT/cortex-worktrees/deepseek-stage0`
- Candidate branch: `feature/deepseek-harness-stage0`
- Harness release: `0.1.1-rc.2`
- Harness commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Bundle: `@danielblomma/dsh-cortex@2.5.2`
- WO-056 rejected the official process-global MCP topology for concurrent Web
  workspaces. WO-057 instead implements an Agent-scoped native provider.
- The candidate is intentionally uncommitted and unpublished. Review the exact
  dirty worktree; do not silently switch to `main` or the planning checkout.

The WO-057 result record is review intake, not proof. Reproduce material claims
from code, tests, the packed artifact, and the pinned upstream checkout.

## Work Profile

New contract/design — this is the independent acceptance pass for a new core
runtime and distribution boundary. Required roles: Code Quality, Contract,
Security and Privacy, Integration, Validation, and Ops/Release.

The reviewing agent/session must not be the session that implemented WO-057.

## Direct References

Read only these starting references before following concrete imports or test
dependencies:

- `docs/agent-control/context-packets/056-deepseek-harness-session-provider.md`
- `docs/agent-control/wo-056-deepseek-harness-stage0-compatibility.md`
- `docs/agent-control/wo-057-deepseek-harness-contract-security-review.md`
- `docs/agent-control/wo-057-deepseek-harness-session-provider-result.md`
- `docs/agent-control/review-iteration-protocol.md`
- `tests/fixtures/deepseek-harness-compatibility.json`
- `scripts/check-deepseek-harness-compatibility.mjs`
- `plugins/dsh-cortex/package.json`
- `plugins/dsh-cortex/cordis.patch.yml`
- `plugins/dsh-cortex/protocol.mjs`
- `plugins/dsh-cortex/provider.mjs`
- `plugins/dsh-cortex/tools.mjs`
- `plugins/dsh-cortex/skills.mjs`
- `plugins/dsh-cortex/skills-manifest.json`
- `plugins/dsh-cortex/tests/local-subprocess-integration.test.mjs`
- `plugins/dsh-cortex/tests/scoped-integration.test.mjs`
- `tests/deepseek-harness-session-provider.test.mjs`
- `tests/plugin-manifests.test.mjs`
- `tests/plugin-skills.test.mjs`
- `scripts/sync-release-version.mjs`

Use Cortex search/rules/impact before code conclusions. Use the pinned Harness
checkout at `/private/tmp/cortex-wo057-harness-20260827` if its HEAD is still
the exact commit; otherwise clone a fresh temporary checkout and detach at the
exact commit. Inspect only upstream files named by packet 056 and the frozen
compatibility fixture unless a concrete import requires another file.

## Owned Scope

- Read every WO-057 runtime, bundle, test, manifest, lockfile, and skill-copy
  change in the candidate.
- Re-run focused and full gates needed to verify the result record.
- Pack the candidate into a fresh temporary directory and independently check
  contents, exact dependencies, peer closure, headless/Web config composition,
  smoke, upgrade, and removal on the pinned Harness baseline.
- Write only
  `docs/agent-control/wo-058-deepseek-harness-v1-independent-review.md`.

## Out Of Scope

- Runtime, test, dependency, manifest, skill, README, plan, or release edits.
- Triage or fixes for findings; those return to a separate implementation
  iteration.
- V2 proactive retrieval, answer-level experiments, bootstrap/update/watch,
  official Harness MCP integration, or Cortex ranking/indexing changes.
- Commit, push, PR, merge, version bump, tag, npm publication, or README status
  promotion.

## Review Checklist

### Contract and code quality

- Exact calling-Agent object identity gates every model-facing execution.
- Every call derives an existing absolute canonical workspace only from
  `agent.session.header.cwd`; no ambient/static/model-selectable fallback exists.
- The four tool schemas and CLI argv preserve public maxima, `--json`, delimiter
  safety, success/failure envelope validation, and do not duplicate ranking.
- The provider resolves the exact direct Cortex package export and never uses a
  shell, `npx`, PATH-only Cortex, private retrieval modules, or a registry tag.
- `required: true` is agent-local readiness only; it is not proactive retrieval
  and cannot block other agents or process activation.
- Abstractions, names, comments, and tests follow nearby Harness/Cortex patterns
  and do not add unnecessary lifecycle state.

### Security and privacy

- Missing/substituted identity and invalid/rebound workspace cases fail closed
  before spawn or remain bound to the already canonical root.
- Two simultaneous indexed roots cannot see, execute, or receive one another's
  tool, skill, readiness, or result state.
- Query strings, flag-like text, spaces, shell metacharacters, and malformed
  child output cannot change authority or escape argv treatment.
- Caller abort and the provider deadline terminate and await the complete child
  tree; stdout/stderr/input limits and diagnostic redaction are enforced.
- No explicit environment entries, remote retrieval, telemetry, source upload,
  session export, automatic indexing, watcher, or persistent result cache was
  introduced.
- Agent disposal and bundle teardown remove registrations and retained state.

### Integration, validation, and release readiness

- Reverify all 18 pinned upstream files and the compatibility fixture.
- Re-run provider/unit, real Harness subprocess/scope, manifest, skill-sync,
  version-sync, diff, and dependency-audit gates.
- Re-run root `npm test` and `npm --prefix scaffold/mcp test`; distinguish a
  candidate defect from an environmental failure with concrete evidence.
- Independently pack the bundle and verify only declared runtime files ship.
- Install and upgrade it in fresh pinned Harness headless and Web profiles;
  require clean peer checks, exactly three Cortex config rows, headless help,
  Web HTTP success, controlled shutdown, and clean removal from both profiles.
- Verify retrieval works with PATH discovery and network access denied, while
  the exact package-owned CLI still serves all four commands.
- Confirm no publication or release-state mutation occurred and README remains
  `planned`.

## Finding Format

For every finding record:

- Severity: `blocker`, `major`, `minor`, or `note`.
- Area: contract, code quality, security/privacy, integration, validation, or
  ops/release.
- Finding.
- Evidence with exact file/line, command, or artifact observation.
- Required action: fix, defer with rationale, or manager decision.

Do not fix findings in this review. A role returns GO only with no unresolved
finding for that role. Any blocker, major, or minor makes overall status NO-GO.

## Required Output

Create `docs/agent-control/wo-058-deepseek-harness-v1-independent-review.md`
containing:

- exact candidate worktree, branch, `git status`, Harness pin, and reviewed file
  inventory;
- separate decisions for all six reviewer roles;
- findings in the required format, including an explicit `none` when clean;
- commands run and exact pass/fail totals;
- packed artifact filename, entry count, hashes, and lifecycle observations;
- residual risks and whether R20 may close locally;
- one overall decision: GO or NO-GO;
- if GO, a statement that the candidate is ready for fresh-manager acceptance
  but that merge/publication/V2 remain unauthorized;
- if NO-GO, the exact bounded fix scope for the next implementation iteration.

## Acceptance

WO-058 review output is complete only when every checklist area has independent
evidence and all six roles have an explicit decision. It does not itself merge
or publish the candidate. A fresh manager session consumes the report, triages
any findings, and either accepts WO-057 locally or opens a bounded fix iteration.

## Fresh-Session Rule

Use only this packet, its direct references, and concrete dependencies found
from them. Do not use prior chat summaries or conclusions. Stop after writing
the review report; do not continue into manager acceptance or V2 in the same
session.
