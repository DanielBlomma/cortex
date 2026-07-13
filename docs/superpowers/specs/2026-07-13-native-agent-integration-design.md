# WO-023: Native Agent Integration and Session Bootstrap — Design

Date: 2026-07-13
Status: Approved (design), pending implementation plan
Branch: `feat/native-agent-integration`

## Problem

Cortex ships capability (CLI retrieval, MCP tools) but no behavior layer.
Superpowers delivers behavior: skills with trigger descriptions, a session
bootstrap that re-injects instructions at startup, clear, and compaction, and
plugin manifests that make clients discover everything automatically. Cortex's
plugin directory contains only an MCP manifest, so agents forget to use Cortex
unless a repo-level CLAUDE.md forces them. A skill defines when and how a tool
is used; the tool alone does not create the habit.

## Goals

1. Agents use Cortex automatically in Cortex-enabled repositories: search
   before answering, impact before refactoring, pattern evidence before
   review.
2. The behavior survives new sessions, `/clear`, and compaction.
3. The CLI-first decision (REQ-9) is untouched: the CLI stays the engine,
   the plugin and skills become the behavior layer, and MCP client
   registration stays opt-in outside the plugin path.

## Non-goals

- Copilot or Gemini support (later work order).
- Changes to retrieval, review logic, or the CLI engine.
- External Codex marketplace submission (documented as a manual step).
- Removing `cortex connect` or any REQ-9 behavior.

## Decisions taken

| Decision | Choice |
|---|---|
| Platforms | Claude Code + Codex |
| Skill set | All five: using-cortex, repo-research, change-impact, pattern-review, context-review |
| Session hook | Status check + short bootstrap, cached, silent outside Cortex repos |
| Engine access | CLI-first in skills; MCP via plugin discovery follows the active workspace |
| Structure | One plugin directory, dual manifests, shared skills (Superpowers layout) |
| Process | Baton work order WO-023 on branch `feat/native-agent-integration` |

## Architecture

```
plugins/cortex/
├─ .claude-plugin/plugin.json   (existing, extended metadata)
├─ .codex-plugin/plugin.json    (new: Codex manifest, same skills + MCP)
├─ .mcp.json                    (existing npx command; inherits client cwd,
│                                so MCP follows the active workspace)
├─ skills/
│  ├─ using-cortex/SKILL.md
│  ├─ repo-research/SKILL.md
│  ├─ change-impact/SKILL.md
│  ├─ pattern-review/SKILL.md
│  └─ context-review/SKILL.md
└─ hooks/
   ├─ hooks.json                (Claude Code SessionStart wiring)
   └─ session-start.mjs         (client-neutral Node script)
.claude-plugin/marketplace.json (repo root: marketplace entry)
```

## Skills

Each SKILL.md has YAML frontmatter (`name`, `description`) where the
description is a trigger rule ("Use when ..."), and a short imperative body
that points at `cortex ... --json` commands. Bodies stay within a small size
budget (target < 100 lines) so they are cheap to load.

| Skill | Trigger | Core instruction |
|---|---|---|
| using-cortex | Session start / any code question | Meta-skill: dispatch table for the other four; run `cortex search` before any code answer; never answer from memory; if `.context/` is missing, suggest `cortex bootstrap` instead of guessing |
| repo-research | "How does X work?", exploration | `search` → `related` → open cited files; cite entity ids and paths |
| change-impact | Before refactors or risky changes | `cortex impact` + `related` for blast radius; summarize the surface before editing |
| pattern-review | Reviewing a file or change | `cortex pattern-evidence` per changed file; repo-local evidence before general best practices (rule.repo_local_pattern_review) |
| context-review | Before finishing a PR/review | Enterprise `context.review` when MCP is available; CLI fallback: `pattern-evidence` + `cortex rules` |

The bootstrap only points at `using-cortex`; the other four are reached
through its dispatch table and their own trigger descriptions.

## Session bootstrap

**Claude Code.** `hooks/hooks.json` registers a SessionStart hook (matchers
`startup`, `resume`, `clear`, `compact`) running `hooks/session-start.mjs`.
The `compact` matcher is what makes the behavior survive compaction. The
script:

1. Walks from cwd up to the git root looking for `.context/`. Not found →
   exit silently with no output (zero noise in non-Cortex repositories).
2. Reads `.context/session-status-cache.json` (TTL ~10 minutes). On miss it
   performs a fast local check with no child processes: do the index files
   exist, mtime of the latest update, entity count when cheap to read.
   Budget < 200 ms.
3. Emits a short bootstrap (~8 lines) via `additionalContext`: Cortex is
   active, use the `using-cortex` skill, index age, `cortex update` nudge
   when stale, or a `cortex bootstrap` warning when the index is missing.

Everything is wrapped in try/catch; the hook must never break a session —
the worst case is no injection.

**Codex.** Codex plugins have no SessionStart hook mechanism today. Codex
gets two layers instead: (a) `.codex-plugin/plugin.json` makes the shared
skills discoverable natively, and (b) the AGENTS.md section written by
`cortex init` (`installCodexAgentsSection` in `bin/cortex.mjs`) is upgraded
from two lines about `cortex update` to a compact using-cortex bootstrap.
`session-start.mjs` stays client-neutral so it can be wired up when Codex
adds session hooks.

**MCP follows the workspace.** The existing `.mcp.json` pattern (an `npx`
command inheriting the client's cwd) is reused in the Codex manifest. No
static per-repository registrations; `cortex connect` remains the opt-in
path for non-plugin users.

## Versioning and marketplace

- `scripts/sync-release-version.mjs` (and its `--check` mode) gains
  `.codex-plugin/plugin.json` so releases keep every manifest in sync.
- `.claude-plugin/marketplace.json` at the repo root lists the cortex plugin
  so the repository can be added as a Claude Code plugin marketplace.
- Codex installation is documented in the README; curated-marketplace
  submission is an external, manual step outside this work order.

## Testing

| Test | Verifies |
|---|---|
| `tests/session-bootstrap.test.mjs` (root suite) | Fresh index → bootstrap text; stale index → warning; no `.context` → empty output; corrupt/expired cache → still works; different cwd resolves the right repo (repo switch) |
| Manifest test | Both manifests parse, versions in sync, skills paths valid; `hooks.json` includes the `compact` matcher (re-injection) |
| Skill lint test | Every SKILL.md has frontmatter with `name` and a trigger-phrased `description`; body within size budget |
| `release:sync-version --check` | Extended with the Codex manifest |

## Baton artifacts

Created first, on this branch: context packet
`docs/agent-control/context-packets/013-native-agent-integration.md`, a
WO-023 row in `agent-work-orders.md`, a handoff-ledger entry, a new REQ-12
row in `acceptance-matrix.md` ("Ship a native behavior layer so agents use
Cortex automatically"), and a manager-log note.

## Error handling summary

- Hook: silent no-op outside Cortex repos; try/catch everywhere; cache
  corruption falls back to recompute; never blocks or delays a session
  beyond its small budget.
- Skills: every skill states the degraded path (missing index → suggest
  `cortex bootstrap`/`cortex update`; missing enterprise MCP → CLI
  fallback).
- Manifests: version drift is caught by the extended sync check in CI and
  the release workflow.
