# Cortex

```text
  CCC    OOO   RRRR  TTTTT  EEEEE  X   X
 C   C  O   O  R   R   T    E       X X
 C      O   O  RRRR    T    EEEE     X
 C   C  O   O  R  R    T    E       X X
  CCC    OOO   R   R   T    EEEEE  X   X
```

Local, repo-scoped context platform for code assistants.

The project provides a practical foundation for:
- ingesting code and documentation into a structured knowledge layer
- querying context through an MCP server
- enforcing source-of-truth and conflict rules before context is sent to an AI

## Project Layout

- `.context/` repo knowledge config, ontology, rules, and local storage
- `mcp/` MCP server (TypeScript)
- `scripts/` ingest, refresh, and status commands
- `docs/` architecture and implementation notes

## Quick Start

1. Review `.context/config.yaml` and adapt `source_paths` for your repo:
   - Example: `src`, `docs`, `design`, `.context/notes`, `.context/decisions`, `README.md`
2. Cold start from clone:
   - `./scripts/context.sh bootstrap`
3. Incremental update during development:
   - `./scripts/context.sh update`
4. Check status:
   - `./scripts/context.sh status`
5. Start MCP server:
   - `cd mcp && npm run dev`
6. Capture tacit team knowledge:
   - `./scripts/context.sh note "Invoice edge-case" "Customer X needs ..."`

## Generated Output

After ingestion, data is written under `.context/`:
- `.context/cache/documents.jsonl` full text records for indexed files
- `.context/cache/entities.*.jsonl` entity sets (`file`, `adr`, `rule`)
- `.context/cache/relations.*.jsonl` discovered relationships
- `.context/embeddings/entities.jsonl` local embedding vectors for unified semantic retrieval
- `.context/embeddings/manifest.json` embedding model + generation stats
- `.context/db/import/*.tsv` import-ready node/relationship tables for graph loading
- `.context/cache/manifest.json` summary counts and ingest metadata
- `.context/cache/graph-manifest.json` graph load summary
- `.context/db/graph.kuzu` local graph database used by MCP search/related/rules tools

## Runtime Commands

- `./scripts/context.sh bootstrap` install deps + full ingest + graph load
- `./scripts/context.sh ingest` full ingest
- `./scripts/context.sh ingest --changed` incremental ingest from git diff, preserving previous indexed records (`full` fallback if git diff is unavailable)
- `./scripts/context.sh embed [--changed]` generate/reuse all-MiniLM embeddings for files/ADRs/rules
- `./scripts/context.sh update` incremental ingest + graph rebuild
- `./scripts/context.sh graph-load` rebuild graph from cached entities/relations
- `./scripts/context.sh note <title> [text]` store tacit team knowledge as indexed notes
- `./scripts/context.sh status` show ingest + graph status

## v1 Scope

- Entities: `File`, `Rule`, `ADR`
- Relations: `IMPLEMENTS`, `CONSTRAINS`, `SUPERSEDES`
- Tools:
  - `context.search`
  - `context.get_related`
  - `context.get_rules`
  - `context.reload`

## Next Step

Expand ontology with `APIContract`, `Test`, and `Owner` after baseline retrieval quality is validated.
