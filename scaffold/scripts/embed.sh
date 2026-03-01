#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_ROOT/mcp"

if ! command -v npm >/dev/null 2>&1; then
  echo "[embed] npm is required but not found on PATH"
  exit 1
fi

mkdir -p "$MCP_DIR/.npm-cache"

echo "[embed] generating embeddings via mcp/embed"
NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" run embed --silent -- "$@"
