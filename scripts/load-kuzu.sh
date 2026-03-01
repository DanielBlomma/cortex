#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_ROOT/mcp"

if [[ ! -f "$MCP_DIR/package.json" ]]; then
  echo "[graph-load] missing $MCP_DIR/package.json"
  exit 1
fi

if [[ ! -d "$MCP_DIR/node_modules" ]]; then
  echo "[graph-load] node_modules missing in mcp/"
  echo "[graph-load] run: cd mcp && NPM_CONFIG_CACHE=$MCP_DIR/.npm-cache npm install"
  exit 1
fi

NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" run graph:load -- "$@"
