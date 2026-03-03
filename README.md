# Cortex MCP

`@danielblomma/cortex-mcp` is a local, repo-scoped context platform for coding assistants.
It indexes your codebase into structured entities (files, rules, ADRs) and exposes that context over MCP (JSON-RPC over stdio).

![Cortex install and bootstrap demo](https://raw.githubusercontent.com/DanielBlomma/cortex/main/docs/install-demo.gif)

## Why Use Cortex

- Semantic search across code and documentation.
- Graph relationships between entities and architectural constraints.
- Local-first: your code and context stay on your machine.
- Incremental updates keep context fresh as the repo changes.
- Works with Claude Code/Desktop and Codex MCP clients.

## Core Features

- Semantic search (files, rules, ADRs).
- Graph relationships between entities and constraints.
- Architectural rules and ADR context for implementation decisions.

## Advanced Features (Experimental)

Cortex can extract function-level chunks and build call graphs in experimental builds:

- `context.find_callers` - what calls this function?
- `context.trace_calls` - what does this function call?
- `context.impact_analysis` - what is impacted if this function changes?
- Requires JavaScript/TypeScript codebase and semantic chunking/call graph indexing enabled.

These APIs are experimental and may not be exposed in every installation.

## Requirements

- Node.js 18+
- Git repository
- Optional for auto-connection: `claude` and/or `codex` CLI in `PATH`

## Install

```bash
npm i -g @danielblomma/cortex-mcp
```

## Quick Start

From the repository you want to index:

```bash
cortex init --bootstrap
```

This will:

- scaffold `.context/`, `scripts/`, `mcp/`, `.githooks/`, and docs files
- build and prepare the local MCP server
- try to auto-register MCP connections for Claude/Codex (if installed)
- start background sync unless disabled

Disable watcher setup:

```bash
cortex init --bootstrap --no-watch
```

## Verify MCP Connection

Claude:

```bash
claude mcp list
```

Codex:

```bash
codex mcp list
```

## Claude Plugin Marketplace

Install via Claude Code plugin marketplace:

```bash
/plugin marketplace add DanielBlomma/cortex
/plugin install cortex@cortex-marketplace
/plugin enable cortex
```

Then initialize Cortex in your target repository:

```bash
cortex init --bootstrap
```

## Manual MCP Configuration

If auto-registration is unavailable, configure MCP manually.

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cortex": {
      "command": "cortex",
      "args": ["mcp"],
      "env": {
        "CORTEX_PROJECT_ROOT": "/absolute/path/to/your-project"
      }
    }
  }
}
```

Codex (`~/.config/codex/mcp-config.json`):

```json
{
  "mcpServers": {
    "cortex-myproject": {
      "command": "cortex",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/your-project"
    }
  }
}
```

## MCP Tools

### `context.search`

Ranked context search across indexed entities.

Input:

- `query` (string, required)
- `top_k` (int, 1-20, default `5`)
- `include_deprecated` (bool, default `false`)
- `include_content` (bool, default `false`)

### `context.get_related`

Fetch entity relationships from the graph.

Input:

- `entity_id` (string, required)
- `depth` (int, 1-3, default `1`)
- `include_edges` (bool, default `true`)

### `context.get_rules`

List indexed rules and optionally include inactive rules.

Input:

- `scope` (string, optional)
- `include_inactive` (bool, default `false`)

### `context.reload`

Reload the RyuGraph connection after updates/maintenance.

Input:

- `force` (bool, default `true`)

## Example Prompts

- "Find files that handle authentication."
- "Show related files for this ADR."
- "What active architectural rules apply to this API?"

## Common Commands

```text
cortex init [path] [--force] [--bootstrap] [--connect] [--no-connect] [--watch] [--no-watch]
cortex connect [path] [--skip-build]
cortex mcp
cortex bootstrap
cortex update
cortex status
cortex watch [start|stop|status|run|once] [--interval <sec>] [--debounce <sec>] [--mode <auto|event|poll>]
cortex note <title> [text]
cortex plan
cortex todo [text|list|done <id>|reopen <id>|remove <id>]
cortex help
```

## Limitations

- Requires repo initialization (`cortex init --bootstrap`).
- Each repository has its own local Cortex context instance.
- No cloud sync by design (privacy-first local storage).

## Security and Privacy

- Cortex stores context data locally under `.context/`.
- No source code upload is required for core functionality.

## Troubleshooting

- `mcp/dist/server.js` missing:
  Run `cortex bootstrap` (or re-run `cortex init --bootstrap`).
- `claude` or `codex` not found during init:
  Auto-registration is skipped; use manual config above.
- MCP tools return stale context:
  Run `cortex update`, then reconnect MCP or call `context.reload` from your MCP client.

## Support

- Issues: https://github.com/DanielBlomma/cortex/issues
- Marketplace prep notes: [docs/MCP_MARKETPLACE.md](docs/MCP_MARKETPLACE.md)

## License

MIT
