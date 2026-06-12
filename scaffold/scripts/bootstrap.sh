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

# Runs `npm install` for a prefix only when its package-lock.json changed
# since the last successful install (or node_modules is missing). A warm
# no-op install still costs npm tens of seconds per prefix; the lockfile-hash
# marker makes repeat bootstraps and updates skip it entirely.
install_deps_if_changed() {
  local prefix="$1" cache="$2"
  local lock="$prefix/package-lock.json"
  local marker="$prefix/node_modules/.cortex-lock-hash"
  local current=""
  if [ -f "$lock" ]; then
    current=$(node -e '
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
    ' "$lock" 2>/dev/null || true)
  fi
  if [ -n "$current" ] && [ -d "$prefix/node_modules" ] && [ -f "$marker" ] \
    && [ "$(cat "$marker" 2>/dev/null)" = "$current" ]; then
    info "dependencies up to date in $prefix (lockfile unchanged)"
    return 0
  fi
  NPM_CONFIG_CACHE="$cache" npm --prefix "$prefix" install --no-fund --no-update-notifier --loglevel=warn
  if [ -n "$current" ]; then
    printf '%s' "$current" > "$marker" || true
  fi
}

step "Installing MCP dependencies"
info "note: upstream RyuGraph dependencies may print deprecation warnings during install"
install_deps_if_changed "$MCP_DIR" "$MCP_DIR/.npm-cache"
install_deps_if_changed "$REPO_ROOT/.context/scripts/parsers" "$REPO_ROOT/.context/scripts/parsers/.npm-cache"

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
