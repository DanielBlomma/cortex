<p align="center">
  <img src="docs/logo.png" alt="Cortex" width="600" />
</p>

# Cortex

**Local code context for AI coding agents.**

[![npm version](https://img.shields.io/npm/v/%40danielblomma%2Fcortex-mcp)](https://www.npmjs.com/package/@danielblomma/cortex-mcp)
[![npm downloads](https://img.shields.io/npm/dw/%40danielblomma%2Fcortex-mcp)](https://www.npmjs.com/package/@danielblomma/cortex-mcp)
[![license](https://img.shields.io/npm/l/%40danielblomma%2Fcortex-mcp)](./LICENSE)
[![website](https://img.shields.io/badge/website-cortex-2563eb)](https://danielblomma.github.io/cortex/)

Cortex gives coding agents a map of your repository before they answer a
question or change code. It indexes files, symbols, relationships, and project
rules, then makes that context available through a simple CLI.

Your source code and index stay on your machine. **MCP is not required.**

## Quick start

Requirements: Node.js 20.9 or newer and a Git repository.

```bash
npm install --global @danielblomma/cortex-mcp
cd your-project
cortex init --bootstrap
```

The last command:

- creates the local `.context/` runtime;
- indexes the repository;
- adds Cortex instructions for coding agents to `AGENTS.md`;
- installs Git hooks that keep context fresh;
- starts the background watcher.

Check that everything works:

```bash
cortex doctor
cortex search "where is authentication handled?" --json
```

That is enough to start using Cortex.

## How agents use Cortex

`cortex init` teaches repository-aware agents to search before guessing. The
normal workflow is:

1. Search for the relevant code.
2. Follow relationships when more context is needed.
3. Check rules and impact before changing code.
4. Refresh and review context after a substantial change.

```bash
# Find relevant code and symbols.
cortex search "payment retry behavior" --json

# Explore dependencies around a result.
cortex related file:src/payments/retry.ts --json

# Understand the likely blast radius of a change.
cortex impact "payment retry behavior" --json

# Read active architectural rules.
cortex rules --json

# Compare a changed file with nearby repository patterns.
cortex pattern-evidence src/payments/retry.ts --json

# Refresh context after significant changes.
cortex update
```

Codex and other agents can run these commands directly in the repository. They
do not need an MCP connection.

## What Cortex adds

Without Cortex, an agent often searches by filename and reads many unrelated
files. Cortex gives it structured repository context:

- semantic search across code, rules, and architecture decisions;
- symbol definitions and file relationships;
- caller and dependency traversal;
- impact analysis before refactoring;
- active rules, deprecations, and source-of-truth signals;
- incremental updates after Git and filesystem changes.

The pipeline is local and straightforward:

```text
repository -> local index -> Cortex CLI -> coding agent
```

## Commands you will use

| Command | Purpose |
| --- | --- |
| `cortex search "..." --json` | Find relevant code and context |
| `cortex related <entity-id> --json` | Follow relationships from a result |
| `cortex impact "..." --json` | Estimate the blast radius of a change |
| `cortex rules --json` | Show active repository rules |
| `cortex pattern-evidence <file> --json` | Find nearby implementation patterns |
| `cortex update` | Refresh changed context |
| `cortex status` | Show index status |
| `cortex doctor` | Diagnose the local setup |
| `cortex watch status` | Check background synchronization |
| `cortex dashboard` | Open the local status dashboard |

Run `cortex help` for the complete command list.

## Large repositories

Normal `cortex bootstrap` completes the whole index before returning. For a
large first-time index, you can make lexical and graph search available first
and let semantic indexing continue in the background:

```bash
cortex bootstrap --background --profile interactive
cortex indexing status --json
```

Pause or resume that background work when needed:

```bash
cortex indexing pause
cortex indexing resume
```

The interactive profile uses conservative resource limits. It is supported on
macOS, Linux, and WSL. Native Windows should use normal foreground bootstrap.

## Keep context fresh

Git hooks and the watcher normally update Cortex automatically.

```bash
cortex watch status
cortex status
```

Run `cortex update` manually after a large change or whenever search results
look stale.

## Upgrade Cortex

```bash
npm install --global @danielblomma/cortex-mcp@latest
cortex init --force
cortex bootstrap
cortex update
```

`cortex init --force` updates Cortex-managed scaffold files while preserving
project configuration, rules, Enterprise settings, and agent instructions.
See [CHANGELOG.md](CHANGELOG.md) for version-specific notes.

## Configuration

Project configuration lives in `.context/config.yaml`, and repository rules
live in `.context/rules.yaml`.

New projects index the repository root. Standard Git-ignored, untracked paths
are skipped. Add a specific ignored directory to `source_paths` only when it
intentionally belongs in the context index.

## Optional integrations

The CLI is the primary interface. No integration is required for Codex or any
agent that can run shell commands.

Claude Code users can optionally install the Cortex behavior plugin:

```text
/plugin marketplace add DanielBlomma/cortex
/plugin install cortex@cortex
```

If a client explicitly requires MCP, run `cortex connect`. MCP is a
compatibility bridge to the same local context; it is not the normal Cortex
workflow.

## Dashboard

```bash
cortex dashboard
```

![Cortex dashboard](https://raw.githubusercontent.com/DanielBlomma/cortex/main/docs/dashboard-screenshot.png)

The dashboard shows index health, freshness, relations, embeddings, and the
most connected parts of the repository.

## Privacy

- Source code stays on the local machine.
- Context data is stored under `.context/` in each repository.
- Core search and indexing require no cloud service.
- Each repository has its own context instance.

## Troubleshooting

```bash
cortex doctor
```

- Runtime missing: run `cortex bootstrap`.
- Search results look stale: run `cortex update`.
- Watcher is not running: run `cortex watch start`.
- Large initial index: use the interactive background profile shown above.
- Windows: run Cortex inside WSL.

## Links

- [Website](https://danielblomma.github.io/cortex/)
- [Changelog](CHANGELOG.md)
- [Bootstrap benchmark](benchmark/bootstrapbench/README.md)
- [Issues](https://github.com/DanielBlomma/cortex/issues)

## License

MIT
