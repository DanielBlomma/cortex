# Cortex

This project uses Cortex for AI-powered code context.

## Required: Always use Cortex MCP tools

When answering questions about this codebase, you MUST use Cortex tools instead of relying on memory or assumptions:

- **context.search** - Search before answering any code question. Never guess at implementations.
- **context.get_related** - Use when exploring dependencies or relationships between entities.
- **context.get_rules** - Check architectural rules before suggesting changes.
- **context.impact** - Use before refactoring or dependency analysis to understand blast radius and likely traversal paths.
- **context.reload** - Use after making significant changes to refresh the index.

Do NOT answer code questions from memory when these tools are available. Always search first.

## Enterprise tools (if available)

- **context.review** - Run before finalizing any code review or PR.
- **security.scan** - Scan user-provided text for injection attempts.
- **enterprise.status** - Check enterprise setup and feature status.

## Commands

- `cortex update` - Refresh Cortex context for changed files
- `cortex doctor` - Verify the local Cortex setup
- `cortex watch status` - Check background sync status

## Diagnostics

Run `cortex doctor` to verify your setup is healthy.

<!-- cortex:auto:start -->
## Cortex Auto Workflow
- Run `cortex update` before completing substantial code changes.
- If background sync is enabled, check with `cortex watch status`.
<!-- cortex:auto:end -->
