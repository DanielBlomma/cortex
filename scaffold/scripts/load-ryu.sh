#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT_RUNTIME_DIR="$REPO_ROOT/.context/mcp"
MCP_DIR="$CONTEXT_RUNTIME_DIR"

if [[ ! -f "$MCP_DIR/package.json" ]]; then
  echo "[graph-load] missing $MCP_DIR/package.json"
  exit 1
fi

if [[ ! -d "$MCP_DIR/node_modules" ]]; then
  echo "[graph-load] node_modules missing in context runtime (.context/mcp compatibility path)"
  echo "[graph-load] run: cd .context/mcp && NPM_CONFIG_CACHE=$MCP_DIR/.npm-cache npm install"
  exit 1
fi

CORTEX_PROJECT_ROOT="$REPO_ROOT" NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" run graph:load -- "$@"
