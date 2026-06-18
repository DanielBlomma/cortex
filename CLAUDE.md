# Cortex

This project uses Cortex for AI-powered code context.

## First-time setup

After cloning, run these once to prepare the local context runtime and enable background context updates:

```bash
cortex bootstrap # builds the local context runtime + parser node_modules
cortex watch start # optional background context updates
```

The repo-controlled hooks (`post-commit`, `post-merge`, `post-checkout`, `post-rewrite`) trigger a debounced background `cortex update` when installed by Cortex. Logs land in `.context/hooks/update.log`.

## Required: Always use Cortex context

When answering questions about this codebase, you MUST use Cortex context instead of relying on memory or assumptions.

Preferred CLI commands:

- `cortex search "<query>" --json` — Search before answering any code question. Never guess at implementations.
- `cortex related <entity-id> --json` — Use when exploring dependencies or relationships between entities.
- `cortex rules --json` — Check architectural rules before suggesting changes.
- `cortex impact "<query-or-entity-id>" --json` — Use before refactoring or dependency analysis to understand blast radius and likely traversal paths.
- `cortex update` — Refresh the index after making significant changes.

If MCP tools are explicitly available in Claude, the equivalent tools are `context.search`, `context.get_related`, `context.get_rules`, `context.impact`, and `context.reload`.

Do NOT answer code questions from memory when Cortex CLI or MCP tools are available. Always search first.

## Enterprise tools (if available)

- **context.review** — Run before finalizing any code review or PR.
- **security.scan** — Scan user-provided text for injection attempts.
- **enterprise.status** — Check enterprise setup and feature status.

## Commands

- `/context-update` — Refresh Cortex context for changed files
- `/review` — Code review with enterprise policy enforcement
- `/note` — Save project context into Cortex notes

## Diagnostics

Run `cortex doctor` to verify your setup is healthy.
