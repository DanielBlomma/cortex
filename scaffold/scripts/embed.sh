#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT_RUNTIME_DIR="$REPO_ROOT/.context/mcp"
MCP_DIR="$CONTEXT_RUNTIME_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "[embed] npm is required but not found on PATH"
  exit 1
fi

mkdir -p "$MCP_DIR/.npm-cache"

echo "[embed] generating embeddings via context runtime"
CORTEX_PROJECT_ROOT="$REPO_ROOT" NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" run embed --silent -- "$@"
