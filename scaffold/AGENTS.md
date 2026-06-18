# Cortex

This project uses Cortex for AI-powered code context.

## Required: Always use Cortex context

When answering questions about this codebase, you MUST use Cortex context instead of relying on memory or assumptions.

Preferred CLI commands:

- `cortex search "<query>" --json` - Search before answering any code question. Never guess at implementations.
- `cortex related <entity-id> --json` - Use when exploring dependencies or relationships between entities.
- `cortex rules --json` - Check architectural rules before suggesting changes.
- `cortex impact "<query-or-entity-id>" --json` - Use before refactoring or dependency analysis to understand blast radius and likely traversal paths.
- `cortex update` - Refresh the index after making significant changes.

If MCP tools are explicitly available in your client, the equivalent tools are `context.search`, `context.get_related`, `context.get_rules`, `context.impact`, and `context.reload`.

Do NOT answer code questions from memory when Cortex CLI or MCP tools are available. Always search first.

## Enterprise tools (if available)

- **context.review** - Run before finalizing any code review or PR.
- **security.scan** - Scan user-provided text for injection attempts.
- **enterprise.status** - Check enterprise setup and feature status.

## Commands

- `cortex update` - Refresh Cortex context for changed files
- `cortex doctor` - Verify the local Cortex setup
- `cortex watch status` - Check background sync status

## Diagnostics

Run `cortex doctor` to verify your setup is healthy. MCP client registration is optional; run `cortex connect` only when your local assistant needs MCP.

<!-- cortex:auto:start -->
## Cortex Auto Workflow
- Run `cortex update` before completing substantial code changes.
- If background sync is enabled, check with `cortex watch status`.
<!-- cortex:auto:end -->
