# Cortex

This project uses Cortex for AI-powered code context.

## First-time setup

After cloning, run these once to make the MCP server work and enable background context updates:

```bash
cortex bootstrap # builds .context/mcp/dist/server.js + parser node_modules
cortex watch start # optional background context updates
```

The repo-controlled hooks (`post-commit`, `post-merge`, `post-checkout`, `post-rewrite`) trigger a debounced background `cortex update` when installed by Cortex. Logs land in `.context/hooks/update.log`.

## Required: Always use Cortex MCP tools

When answering questions about this codebase, you MUST use Cortex tools instead of relying on memory or assumptions:

- **context.search** — Search before answering any code question. Never guess at implementations.
- **context.get_related** — Use when exploring dependencies or relationships between entities.
- **context.get_rules** — Check architectural rules before suggesting changes.
- **context.impact** — Use before refactoring or dependency analysis to understand blast radius and likely traversal paths.
- **context.reload** — Use after making significant changes to refresh the index.

Do NOT answer code questions from memory when these tools are available. Always search first.

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
