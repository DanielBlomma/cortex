# Context Packet 013: Native Agent Integration and Session Bootstrap

Date: 2026-07-13
Work order: WO-023
Requirement: REQ-12
Spec: docs/superpowers/specs/2026-07-13-native-agent-integration-design.md

## Problem

Cortex ships capability (CLI retrieval, MCP tools) but no behavior layer.
Agents forget to use Cortex unless a repo-level CLAUDE.md forces them. A
skill defines when and how a tool is used; the tool alone does not create
the habit (compare Superpowers: skills + session bootstrap + plugin
discovery).

## Scope

- `plugins/cortex/`: add `.codex-plugin/plugin.json`, `skills/` (five
  skills), `hooks/hooks.json`, `hooks/session-start.mjs`.
- `.claude-plugin/marketplace.json` at the repo root.
- `bin/cortex.mjs`: upgrade `installCodexAgentsSection` bootstrap text.
- `scripts/sync-release-version.mjs`: cover the Codex manifest.
- Tests: `tests/session-bootstrap.test.mjs`, `tests/plugin-manifests.test.mjs`,
  `tests/plugin-skills.test.mjs`, extended `tests/init-agents.test.mjs`.

## Non-scope

Copilot/Gemini, retrieval/review logic, REQ-9 changes, external Codex
marketplace submission.

## Constraints

- CLI-first (REQ-9): skills instruct `cortex ... --json`; MCP arrives via
  plugin discovery only.
- The session hook must never fail or noticeably delay a session; silent
  no-op outside Cortex repos.
- Keep ``Run `cortex update` `` in the AGENTS.md section (existing test
  asserts it).
