#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_DIR="$REPO_ROOT/.context/mcp"
TOTAL_STEPS=6
STEP_INDEX=0

step() {
  STEP_INDEX=$((STEP_INDEX + 1))
  echo ""
  echo "[cortex][$STEP_INDEX/$TOTAL_STEPS] $1"
}

info() {
  echo "[cortex] $1"
}

info "bootstrap start"
info "repo: $REPO_ROOT"
info "pipeline: deps -> ingest -> embeddings -> graph -> status"

mkdir -p "$MCP_DIR/.npm-cache"

step "Installing MCP dependencies"
info "note: upstream RyuGraph dependencies may print deprecation warnings during install"
NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" install --no-fund --no-update-notifier --loglevel=warn
NPM_CONFIG_CACHE="$REPO_ROOT/.context/scripts/parsers/.npm-cache" npm --prefix "$REPO_ROOT/.context/scripts/parsers" install --no-fund --no-update-notifier --loglevel=warn

source "$SCRIPT_DIR/lib/enterprise-check.sh"

step "Indexing repository context"
"$SCRIPT_DIR/ingest.sh"

step "Generating semantic embeddings"
if ! "$SCRIPT_DIR/embed.sh"; then
  info "warning: embedding generation failed; continuing with lexical search fallback"
fi

step "Loading RyuGraph"
"$SCRIPT_DIR/load-ryu.sh"

step "Reading context status"
"$SCRIPT_DIR/status.sh"

echo ""
info "bootstrap complete"
info "next: run cortex update while coding"
