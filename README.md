<p align="center">
  <img src="docs/logo.png" alt="Cortex" width="600" />
</p>

# Cortex

**Give AI coding agents the right context from your repository.**

[![npm version](https://img.shields.io/npm/v/%40danielblomma%2Fcortex-mcp)](https://www.npmjs.com/package/@danielblomma/cortex-mcp)
[![license](https://img.shields.io/npm/l/%40danielblomma%2Fcortex-mcp)](./LICENSE)

Cortex builds a local map of your code, symbols, relationships, and project
rules. Coding agents query that map through the CLI instead of guessing or
reading the whole repository.

Your code stays on your machine. MCP is not required.

## Start

Requires Node.js 20.9+ and Git.

```bash
npm install --global @danielblomma/cortex-mcp
cd your-project
cortex init --bootstrap
```

This indexes the repository, adds Cortex instructions to `AGENTS.md`, installs
Git hooks, and starts the background watcher.

Check the setup:

```bash
cortex doctor
```

## Use

```bash
# Find relevant code.
cortex search "where is authentication handled?" --json

# Follow relationships from a search result.
cortex related <entity-id> --json

# See what a change may affect.
cortex impact "authentication" --json

# Read repository rules.
cortex rules --json

# Compare a changed file with nearby patterns.
cortex pattern-evidence src/auth.ts --json
```

Agents can run these commands directly. `cortex init` adds instructions that
tell them to search before answering and check impact before refactoring.

## Keep the index fresh

Git hooks and the watcher normally update Cortex automatically.

```bash
cortex status
cortex watch status
cortex update
```

Run `cortex update` manually after a large change or when results look stale.

## Large repositories

Make lexical and graph search available first while semantic indexing continues
in the background:

```bash
cortex bootstrap --background --profile interactive
cortex indexing status --json
```

This mode supports macOS, Linux, and WSL. Native Windows should use normal
foreground bootstrap.

## Upgrade

```bash
npm install --global @danielblomma/cortex-mcp@latest
cortex init --force
cortex bootstrap
cortex update
```

Project configuration and rules are preserved. See
[CHANGELOG.md](CHANGELOG.md) for version-specific notes.

## Optional MCP compatibility

The normal Cortex workflow uses the CLI. If a client explicitly requires MCP,
run `cortex connect`.

## DeepSeek Harness integration (planned)

An installable Cortex integration for DeepSeek Harness is planned, but is not
available yet. Stage 0 verified the upstream APIs and found that the official
MCP bridge cannot safely isolate concurrent Web workspaces. The selected V1
candidate instead binds a native Cortex provider and its tools to each Harness
agent workspace. Local implementation and validation are complete; independent
final acceptance and explicit release authorization are still pending. See the
[V1-to-V2 integration plan](docs/superpowers/plans/2026-08-25-deepseek-harness-integration.md).

## Links

- [Website](https://danielblomma.github.io/cortex/)
- [Changelog](CHANGELOG.md)
- [Issues](https://github.com/DanielBlomma/cortex/issues)

## License

MIT
