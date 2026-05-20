#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

# Install parser deps under .context/parsers/ and symlink back into scripts/parsers/.
# Keeps all generated state under .context/ so a single `.context/` ignore covers it.
PARSERS_INSTALL_DIR="$REPO_ROOT/.context/parsers"

if [ -e "$REPO_ROOT/scripts/parsers/node_modules" ] && [ ! -L "$REPO_ROOT/scripts/parsers/node_modules" ]; then
  rm -rf "$REPO_ROOT/scripts/parsers/node_modules"
fi
rm -rf "$REPO_ROOT/scripts/parsers/.npm-cache"

mkdir -p "$PARSERS_INSTALL_DIR"
ln -sfn "$REPO_ROOT/scripts/parsers/package.json"      "$PARSERS_INSTALL_DIR/package.json"
ln -sfn "$REPO_ROOT/scripts/parsers/package-lock.json" "$PARSERS_INSTALL_DIR/package-lock.json"

NPM_CONFIG_CACHE="$PARSERS_INSTALL_DIR/.npm-cache" npm --prefix "$PARSERS_INSTALL_DIR" install --no-fund --no-update-notifier --loglevel=warn

ln -sfn "$PARSERS_INSTALL_DIR/node_modules" "$REPO_ROOT/scripts/parsers/node_modules"

source "$REPO_ROOT/scripts/lib/enterprise-check.sh"

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
