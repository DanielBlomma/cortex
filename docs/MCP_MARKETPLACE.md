# MCP Marketplace Submission

## Package Information

**Name:** `@danielblomma/cortex-mcp`  
**Description:** Local, repo-scoped context platform for coding assistants. Function-level search, call graph analysis, and impact tracing.  
**Author:** Daniel Blomma  
**License:** MIT  
**Repository:** https://github.com/DanielBlomma/cortex

## MCP Server Details

### Tools Provided

1. **context.search**
   - Semantic search across codebase (files, functions, rules, ADRs)
   - Supports entity type filtering (File, Chunk, Rule, ADR)
   - Function-level granularity with call graph integration

2. **context.get_related**
   - Graph-based entity relationships
   - Finds dependencies, definitions, and references

3. **context.get_rules**
   - Active rules and architectural decisions
   - Scope-based filtering

4. **context.find_callers** (NEW - Semantic Chunking)
   - Reverse call graph: what calls this function?
   - Impact analysis for refactoring

5. **context.trace_calls** (NEW - Semantic Chunking)
   - Forward call graph: what does this function call?
   - Dependency tracing

6. **context.impact_analysis** (NEW - Semantic Chunking)
   - Multi-hop impact analysis for changes
   - Safe refactoring guidance

7. **context.reload**
   - Hot-reload graph after code changes

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
- Extract function-level chunks and call graphs

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
"Find all functions that handle authentication"
"Show me the call graph for parseCode"
"What would break if I change extractCalls?"
"What are the active architectural rules for this API?"
```

### Key Features

- **Function-level search**: Not just files, but individual functions/methods
- **Call graph analysis**: Trace dependencies and impact
- **Local & private**: All data stays on your machine
- **Incremental updates**: Background sync keeps context fresh
- **Multi-language**: JavaScript/TypeScript today, Python/Go planned

### Requirements

- Node.js 18+
- Git repository (for change tracking)
- ~50MB disk space per project

### Unique Value Proposition

Unlike other MCP servers that provide external data (GitHub, web search), Cortex provides **deep, structured knowledge of YOUR codebase**:

- Search at function/method level (not just files)
- Understand call dependencies and impact
- Enforce architectural rules and ADRs
- Context that evolves with your code

Perfect for:
- Large codebases where file-level context isn't enough
- Refactoring (impact analysis, caller/callee tracing)
- Onboarding (architectural rules, design decisions)
- Code review (what depends on this change?)

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
- [ ] Marketplace-ready README
- [ ] Example usage screenshots/GIFs
- [ ] Submit PR to modelcontextprotocol/servers

## Next Steps

1. Publish to npm as `@danielblomma/cortex-mcp`
2. Test installation from marketplace perspective
3. Submit to https://github.com/modelcontextprotocol/servers
4. Add to Anthropic's community registry
