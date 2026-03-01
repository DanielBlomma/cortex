#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_ROOT/mcp"

mkdir -p "$MCP_DIR/.npm-cache"

echo "[bootstrap] installing MCP dependencies"
NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" install

echo "[bootstrap] running full ingest"
"$REPO_ROOT/scripts/ingest.sh"

echo "[bootstrap] loading graph"
"$REPO_ROOT/scripts/load-kuzu.sh"

echo "[bootstrap] status"
"$REPO_ROOT/scripts/status.sh"
