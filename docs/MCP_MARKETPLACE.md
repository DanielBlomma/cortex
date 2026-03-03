# MCP Marketplace Submission

## Package Information

**Name:** `@danielblomma/cortex-mcp`  
**Description:** Local, repo-scoped context platform for coding assistants. Semantic search, graph relationships, and architectural rule context.  
**Author:** Daniel Blomma  
**License:** MIT  
**Repository:** https://github.com/DanielBlomma/cortex

## MCP Server Details

### Tools Provided

1. **context.search**
   - Semantic search across indexed entities (files, rules, ADRs)
   - Hybrid ranking (semantic + graph + trust + recency)
   - Optional content return for high-signal snippets

2. **context.get_related**
   - Graph-based entity relationships
   - Finds connected rules/files/ADRs with optional edge details

3. **context.get_rules**
   - Active rules and architectural decisions
   - Scope-based filtering

4. **context.reload**
   - Hot-reload graph after code changes

### Advanced Features (Experimental)

Cortex can extract function-level chunks and build call graphs in experimental builds:

- `context.find_callers` - What calls this function?
- `context.trace_calls` - What does this function call?
- `context.impact_analysis` - What is impacted if this function changes?
- Requires JavaScript/TypeScript codebase and semantic chunking/call graph indexing enabled.

Note: these APIs are experimental and are not part of the stable tool contract in this submission.

### Installation

#### For MCP Marketplace Users

```bash
# Install CLI globally
npm i -g @danielblomma/cortex-mcp

# Navigate to your project
cd ~/my-project

# Initialize Cortex in your project
cortex init --bootstrap
```

This will:
- Create `.context/` directory with graph schema
- Set up MCP server for Claude Desktop/Code
- Start background sync for automatic updates
- Build a local context graph for indexed files/rules/ADRs

#### Manual MCP Configuration

If `cortex init` doesn't auto-register, add to Claude's MCP config:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**Codex** (`~/.config/codex/mcp-config.json`):
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

### Usage

Once installed and initialized, Cortex tools are available in Claude:

```
"Find files that handle authentication"
"Show related files for this ADR"
"What are the active architectural rules for this API?"
```

### Key Features

- **Semantic search**: ranked retrieval across source files, rules and ADRs
- **Graph relationships**: quickly discover related entities and constraints
- **Experimental call graph APIs**: function caller/callee and impact traversal in semantic chunking builds
- **Local & private**: All data stays on your machine
- **Incremental updates**: Background sync keeps context fresh
- **Flexible ingestion**: configurable source paths and ranking signals

### Requirements

- Node.js 18+
- Git repository (for change tracking)
- ~50MB disk space per project

### Unique Value Proposition

Unlike other MCP servers that provide external data (GitHub, web search), Cortex provides **deep, structured knowledge of YOUR codebase**:

- Search with semantic ranking across files, rules, and ADRs
- Understand rule and ADR dependencies in your repo
- Enforce architectural rules and ADRs
- Context that evolves with your code

Perfect for:
- Large codebases where plain keyword search is not enough
- Refactoring guided by rule and ADR context
- Onboarding (architectural rules, design decisions)
- Code review (what constraints and related entities apply?)

### Limitations

- **Setup required**: Not instant plug-and-play (needs `cortex init`)
- **Per-project**: Each repo needs its own Cortex instance
- **Local only**: No cloud sync (by design - your code stays private)

### Support

- Issues: https://github.com/DanielBlomma/cortex/issues
- Docs: https://github.com/DanielBlomma/cortex/blob/main/README.md

## Submission Checklist

- [x] MCP SDK integration (JSON-RPC over stdio)
- [x] Tools documented with schemas
- [ ] npm package published (@danielblomma/cortex-mcp)
- [x] Marketplace-ready README
- [ ] Example usage screenshots/GIFs
- [ ] Submit PR to modelcontextprotocol/servers

## Next Steps

1. Publish to npm as `@danielblomma/cortex-mcp`
2. Test installation from marketplace perspective
3. Submit to https://github.com/modelcontextprotocol/servers
4. Add to Anthropic's community registry
