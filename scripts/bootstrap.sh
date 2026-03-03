#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$REPO_ROOT/mcp"
TOTAL_STEPS=5
STEP_INDEX=0

print_logo() {
  cat <<'EOF'
  CCC    OOO   RRRR  TTTTT  EEEEE  X   X
 C   C  O   O  R   R   T    E       X X
 C      O   O  RRRR    T    EEEE     X
 C   C  O   O  R  R    T    E       X X
  CCC    OOO   R   R   T    EEEEE  X   X
EOF
}

step() {
  STEP_INDEX=$((STEP_INDEX + 1))
  echo ""
  echo "[cortex][$STEP_INDEX/$TOTAL_STEPS] $1"
}

info() {
  echo "[cortex] $1"
}

print_logo
info "bootstrap start"
info "repo: $REPO_ROOT"
info "pipeline: deps -> ingest -> embeddings -> graph -> status"

mkdir -p "$MCP_DIR/.npm-cache"

step "Installing MCP dependencies"
info "note: upstream RyuGraph dependencies may print deprecation warnings during install"
NPM_CONFIG_CACHE="$MCP_DIR/.npm-cache" npm --prefix "$MCP_DIR" install --no-fund --no-update-notifier --loglevel=warn
NPM_CONFIG_CACHE="$REPO_ROOT/scripts/parsers/.npm-cache" npm --prefix "$REPO_ROOT/scripts/parsers" install --no-fund --no-update-notifier --loglevel=warn

step "Indexing repository context"
"$REPO_ROOT/scripts/ingest.sh"

step "Generating semantic embeddings"
if ! "$REPO_ROOT/scripts/embed.sh"; then
  info "warning: embedding generation failed; continuing with lexical search fallback"
fi

step "Loading RyuGraph"
"$REPO_ROOT/scripts/load-ryu.sh"

step "Reading context status"
"$REPO_ROOT/scripts/status.sh"

echo ""
info "bootstrap complete"
info "next: run ./scripts/context.sh update while coding"
