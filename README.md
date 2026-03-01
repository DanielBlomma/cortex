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

## Install In Any Repo (npx)

From the repo you want to enable:

1. Initialize Cortex scaffold:
   - `npx github:DanielBlomma/cortex init --bootstrap`
   - This now auto-connects MCP to both Codex and Claude Code.
   - Add `--no-connect` if you only want scaffold + data setup.
2. Daily refresh while coding:
   - `npx github:DanielBlomma/cortex update`
3. Check health:
   - `npx github:DanielBlomma/cortex status`

If you already have scaffold files and want to refresh from template:
- `npx github:DanielBlomma/cortex init --force`

If you want to (re)register MCP integrations later:
- `npx github:DanielBlomma/cortex connect`
- `npx github:DanielBlomma/cortex connect --skip-build` to skip local TypeScript build

## Installation Guide

### Prerequisites

- Node.js 20+ (`node -v`)
- npm 10+ (`npm -v`)
- git (`git --version`)
- Optional (for MCP auto-connect): `codex` CLI and/or `claude` CLI available in `PATH`

### Option A: No global install (recommended)

Run directly from any repository with `npx`:

1. Go to your target repo:
   - `cd /path/to/your-repo`
2. Install scaffold + run first setup:
   - `npx github:DanielBlomma/cortex init --bootstrap`
3. Daily usage:
   - `npx github:DanielBlomma/cortex update`
   - `npx github:DanielBlomma/cortex status`

### Option B: Global install (`cortex` command)

Install once on your machine:

1. Install globally:
   - `npm i -g github:DanielBlomma/cortex`
2. Use in any repo:
   - `cd /path/to/your-repo`
   - `cortex init --bootstrap`
   - `cortex update`
   - `cortex status`

### Reconnect MCP Integrations

If Codex/Claude settings were reset or changed:

- `npx github:DanielBlomma/cortex connect`
- or with global install: `cortex connect`

### Troubleshooting

- If `init` says command not found for `codex` or `claude`, Cortex setup still works. Only MCP auto-registration is skipped.
- During first `bootstrap`, npm may print deprecation warnings from upstream `kuzu` dependencies. Current `npm audit` for `mcp/` is clean after transitive dependency overrides.
- If `mcp/dist/server.js` is missing, run:
  - `npx github:DanielBlomma/cortex bootstrap`
- If scaffold already exists and you want a fresh template copy:
  - `npx github:DanielBlomma/cortex init --force`

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

## Release Status

- V2 is locked (2026-03-01): see [`docs/v2-status.md`](docs/v2-status.md) for completed scope and current security status.
