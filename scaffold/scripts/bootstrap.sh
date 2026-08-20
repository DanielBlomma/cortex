#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT_RUNTIME_DIR="$REPO_ROOT/.context/mcp"
MCP_DIR="$CONTEXT_RUNTIME_DIR"
BACKGROUND=0
PROFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --background)
      BACKGROUND=1
      shift
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    *)
      echo "[cortex] unknown bootstrap option: $1" >&2
      exit 1
      ;;
  esac
done
if [[ "$BACKGROUND" -eq 1 && "$PROFILE" != "interactive" ]]; then
  echo "[cortex] --background requires --profile interactive" >&2
  exit 1
fi
if [[ "$BACKGROUND" -eq 0 && -n "$PROFILE" ]]; then
  echo "[cortex] --profile is only valid with --background" >&2
  exit 1
fi

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
if [[ "$BACKGROUND" -eq 1 ]]; then
  info "pipeline: deps -> ingest -> graph -> background embeddings -> status"
else
  info "pipeline: deps -> ingest -> embeddings -> graph -> status"
fi

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
      // Node version is part of the key: native deps must reinstall after a
      // runtime switch even when the lockfile is unchanged.
      const hash = crypto.createHash("sha256");
      hash.update(process.version);
      hash.update(fs.readFileSync(process.argv[1]));
      console.log(hash.digest("hex"));
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

step "Installing context runtime dependencies"
info "note: upstream RyuGraph dependencies may print deprecation warnings during install"
install_deps_if_changed "$MCP_DIR" "$MCP_DIR/.npm-cache"
install_deps_if_changed "$REPO_ROOT/.context/scripts/parsers" "$REPO_ROOT/.context/scripts/parsers/.npm-cache"

source "$SCRIPT_DIR/lib/enterprise-check.sh"

step "Indexing repository context"
if [[ "$BACKGROUND" -eq 1 ]]; then
  CORTEX_INGEST_WORKERS=2 "$SCRIPT_DIR/ingest.sh"
else
  "$SCRIPT_DIR/ingest.sh"
fi

if [[ "$BACKGROUND" -eq 1 ]]; then
  step "Loading RyuGraph for early search readiness"
  "$SCRIPT_DIR/load-ryu.sh"
  info "search_ready=lexical+graph semantic_coverage=incomplete"

  step "Starting resource-limited semantic indexing"
  node "$SCRIPT_DIR/indexing.mjs" start --profile "$PROFILE"

  step "Reading progressive indexing status"
  node "$SCRIPT_DIR/indexing.mjs" status
else
  step "Generating semantic embeddings"
  if ! "$SCRIPT_DIR/embed.sh"; then
    info "warning: embedding generation failed; continuing with lexical search fallback"
  fi

  step "Loading RyuGraph"
  "$SCRIPT_DIR/load-ryu.sh"

  step "Reading context status"
  "$SCRIPT_DIR/status.sh"
fi

echo ""
if [[ "$BACKGROUND" -eq 1 ]]; then
  info "bootstrap complete; semantic indexing continues in background"
  info "next: cortex indexing status --json (index mutations wait for this run to finish)"
else
  info "bootstrap complete"
  info "next: run cortex update while coding"
fi
