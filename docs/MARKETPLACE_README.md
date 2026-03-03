# Cortex - MCP Server for Code Context

> Local, repo-scoped context platform for coding assistants. Semantic search, graph relationships, and architectural rule context.

[![npm version](https://badge.fury.io/js/%40danielblomma%2Fcortex-mcp.svg)](https://www.npmjs.com/package/@danielblomma/cortex-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is Cortex?

Cortex is an MCP server that gives Claude deep, structured knowledge of YOUR codebase:

- 🔍 **Semantic context search** - Ranked retrieval across files, rules and ADRs
- 🧭 **Graph relationships** - Explore how entities connect
- 🔒 **Local & private** - All data stays on your machine
- ⚡ **Background sync** - Context auto-updates as you code
- 📋 **Architectural rules** - Keep decisions visible during implementation

## Quick Start

```bash
# Install globally
npm i -g @danielblomma/cortex-mcp

# Initialize in your project
cd ~/my-project
cortex init --bootstrap
```

That's it! Cortex is now available in Claude Desktop and Claude Code.

## What Makes Cortex Different?

Unlike other MCP servers that provide external data (GitHub, web search), Cortex provides **deep knowledge of YOUR codebase**:

| Feature | Cortex | File-based context |
|---------|--------|-------------------|
| Search quality | ✅ Semantic + trust + graph ranking | ⚠️ Keyword only |
| Relationships | ✅ Linked rules/files/ADRs | ❌ Flat results |
| Architectural rules | ✅ Enforced via ADRs | ❌ In comments/docs |
| Privacy | ✅ 100% local | Depends on tool |

## Usage Examples

Once installed, ask Claude:

```
"Find files that handle authentication"
"Show related files for this ADR"
"What architectural rules apply to this API?"
```

## Features

### 🔍 Semantic Search
Search across:
- Files (entire source)
- Rules (architectural decisions)
- ADRs (design documents)

### 🧭 Graph Relationships
- **context.get_related**: Find connected entities
- Include edges to inspect relation direction and labels
- Use depth-based traversal for dependency context

### 📋 Architectural Rules
- Define rules in `.context/rules/`
- Query active rules by scope
- Enforce decisions automatically

### ⚡ Background Sync
- Watches for file changes
- Incremental updates (fast!)
- Always up-to-date context

## Supported Languages

**Today:**
- JavaScript / TypeScript (indexing and search)

**Planned:**
- Python
- Go
- Java

## Requirements

- Node.js 18+
- Git repository
- ~50MB disk space per project

## How It Works

1. **Ingest**: Cortex scans your codebase and extracts:
   - Files and their content
   - Functions, methods, classes (chunks)
   - Imports and dependencies
   - Call relationships

2. **Index**: Creates a local graph database + semantic embeddings

3. **Serve**: MCP server exposes tools for Claude to query

4. **Sync**: Background watcher keeps context fresh as you code

## Configuration

Edit `.context/config.yaml` to customize:

```yaml
source_paths:
  - src
  - lib
  
truth_order:
  - ADR
  - RULE
  - CODE

ranking:
  semantic: 0.4
  graph: 0.3
  trust: 0.2
  recency: 0.1
```

## Privacy & Security

- **100% local**: No cloud, no telemetry
- **Your code stays on your machine**
- **No external API calls** (except for local LLM embeddings)

## Troubleshooting

### MCP not showing up in Claude?

```bash
# Verify installation
cortex status

# Re-register MCP
cortex connect

# Check Claude's MCP config
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### Background sync not working?

```bash
# Check watch status
cortex watch status

# Restart watcher
cortex watch stop
cortex watch start
```

### Graph out of date?

```bash
# Force full rebuild
cortex update
```

## Support

- 📖 [Full Documentation](https://github.com/DanielBlomma/cortex)
- 🐛 [Report Issues](https://github.com/DanielBlomma/cortex/issues)
- 💬 [Discussions](https://github.com/DanielBlomma/cortex/discussions)

## License

MIT © Daniel Blomma
