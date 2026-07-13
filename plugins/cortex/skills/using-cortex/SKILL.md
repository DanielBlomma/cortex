---
name: using-cortex
description: Use when starting any conversation or answering any question about code in this repository - establishes that Cortex context must be consulted before answering, and dispatches to the right Cortex skill for research, impact, and review tasks
---

# Using Cortex

Cortex maintains a local, ranked index of this repository (graph, embeddings,
rules). Never answer a code question from memory when Cortex is available.

## The rule

Before answering any question about this codebase, run:

```bash
cortex search "<query>" --json
```

Cite the entity ids and paths you used. If a command fails because there is
no `.context/` directory or no index, say so and suggest `cortex bootstrap`
(first time) or `cortex update` (stale index) instead of guessing.

## Dispatch

| Situation | Skill / command |
|---|---|
| "How does X work?", exploring code | `repo-research` skill |
| Planning a refactor or risky change | `change-impact` skill |
| Reviewing a file or diff | `pattern-review` skill |
| Finalizing a PR or full review | `context-review` skill |
| Architectural constraints | `cortex rules --json` |
| After significant changes | `cortex update` |

## MCP equivalents

If Cortex MCP tools are connected, `context.search`, `context.get_related`,
`context.get_rules`, `context.impact`, and `context.reload` map to the CLI
commands above. Prefer whichever is available; the CLI needs no registration.
