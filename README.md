# Cortex

```text
  CCC    OOO   RRRR  TTTTT  EEEEE  X   X
 C   C  O   O  R   R   T    E       X X
 C      O   O  RRRR    T    EEEE     X
 C   C  O   O  R  R    T    E       X X
  CCC    OOO   R   R   T    EEEEE  X   X
```

Local, repo-scoped context platform for coding assistants.

## What Cortex Is (Plain Language)

If you are not an AI engineer, think of Cortex as a **local project memory** for your repository.

Instead of an assistant trying to read everything from scratch on each prompt, Cortex:

1. Scans your code and documentation.
2. Structures it into entities (files, rules, ADRs) and relationships.
3. Builds a local graph + search index.
4. Lets assistants (Codex/Claude) query that context through MCP tools.

Result: better answers, less guessing, and fewer "hallucinated" assumptions.

## Why Use It

- Keeps context **repo-local** by default.
- Reduces giant instruction files (`claude.md`, `agent.md`) by moving knowledge into indexed context.
- Makes assistant output more consistent with your rules/ADRs/source of truth.
- Supports incremental updates so you do not need full re-ingest on every change.

## Install

### Prerequisites

- Node.js 20+
- npm 10+
- git
- Optional for auto MCP registration: `codex` CLI and/or `claude` CLI in `PATH`

### Option A: Run with npx (recommended)

From the repository you want to enable:

```bash
npx github:DanielBlomma/cortex init --bootstrap
```

What this does:

- copies Cortex scaffold (`.context/`, `scripts/`, `mcp/`)
- bootstraps dependencies + ingest + embeddings + graph
- tries to auto-connect MCP to Codex and Claude Code

Daily commands:

```bash
npx github:DanielBlomma/cortex update
npx github:DanielBlomma/cortex status
```

### Option B: Global install (`cortex` command)

```bash
npm i -g github:DanielBlomma/cortex
```

Then in any repo:

```bash
cortex init --bootstrap
cortex update
cortex status
```

If your global install is root-owned on macOS, you may need:

```bash
sudo npm i -g github:DanielBlomma/cortex
```

## Typical Workflow

### First setup in a repo

```bash
cortex init --bootstrap
```

### During development

```bash
cortex update
cortex status
```

### Reconnect MCP (if CLI/app settings changed)

```bash
cortex connect
```

### Refresh scaffold from latest template

```bash
cortex init --force
```

## Verify It Works in Claude/Codex

In your repo directory:

```bash
claude mcp list
```

You should see `cortex` as connected.

For Codex:

```bash
codex mcp list
codex mcp get cortex-<repo-name> --json
```

## Core MCP Tools

- `context.search`: ranked search across File/Rule/ADR
- `context.get_related`: graph neighbors for an entity
- `context.get_rules`: active rules with scope filtering
- `context.reload`: reload graph connection after updates

## Configure What Gets Indexed

Edit `.context/config.yaml`:

- `source_paths`: folders/files Cortex should ingest
- `truth_order`: source priority (ADR/RULE/CODE/WIKI)
- `ranking`: scoring weights (`semantic`, `graph`, `trust`, `recency`)

Then run:

```bash
cortex update
```

## Custom Entity Types (`ontology.cypher`)

To add your own entities (for example `APIContract`, `Test`, `Owner`):

1. Update schema in `.context/ontology.cypher` (`CREATE NODE TABLE`, `CREATE REL TABLE`).
2. Extend `scripts/ingest.mjs` to emit:
   - `.context/cache/entities.<type>.jsonl`
   - `.context/db/import/<Type>.tsv`
3. Extend `mcp/src/loadGraph.ts` to load new TSV data into RyuGraph.
4. Extend `mcp/src/graph.ts` and optionally `mcp/src/search.ts` to expose/query the new types.
5. Rebuild data:

```bash
./scripts/context.sh ingest
./scripts/context.sh graph-load
./scripts/context.sh status
```

## Commands

```text
cortex init [path] [--force] [--bootstrap] [--connect] [--no-connect]
cortex connect [path] [--skip-build]
cortex bootstrap
cortex update
cortex status
cortex ingest [--changed] [--verbose]
cortex embed [--changed]
cortex graph-load [--no-reset]
cortex note <title> [text]
cortex help
```

## Project Layout

- `.context/` config, ontology, rules, local cache/db/embeddings
- `scripts/` ingest/update/bootstrap/status orchestration
- `mcp/` TypeScript MCP server
- `docs/` architecture and release notes

## Troubleshooting

- `Unknown command: connect`
  - Your global CLI is old. Run `npm i -g github:DanielBlomma/cortex`.
- `codex` / `claude` not found during init
  - Cortex still works; only auto MCP registration is skipped.
- `mcp/dist/server.js` missing
  - Run `cortex bootstrap`.
- RyuGraph DB warnings on cold start
  - Run `./scripts/context.sh graph-load` or full `./scripts/context.sh bootstrap`.

## Notes on Security Warnings

Current `mcp/` audit is clean with dependency overrides in place.
You may still see upstream deprecation warnings (`ryugraph`, `prebuild-install`) during install.

## Release Status

V2 lock/status: see [`docs/v2-status.md`](docs/v2-status.md).
