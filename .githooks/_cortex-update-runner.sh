#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  exit 0
fi

CONTEXT_SCRIPT="$REPO_ROOT/scripts/context.sh"
if [[ ! -x "$CONTEXT_SCRIPT" ]]; then
  exit 0
fi

PARSER_MODULES_DIR="$REPO_ROOT/scripts/parsers/node_modules"

HOOK_DIR="$REPO_ROOT/.context/hooks"
LOCK_DIR="$HOOK_DIR/update.lock"
LAST_RUN_FILE="$HOOK_DIR/last-update.epoch"
LOG_FILE="$HOOK_DIR/update.log"
MIN_INTERVAL_SEC="${CORTEX_HOOK_MIN_INTERVAL:-8}"

mkdir -p "$HOOK_DIR"

if [[ ! -d "$PARSER_MODULES_DIR" ]]; then
  printf "[hook] %s skip update (missing %s, run cortex bootstrap)\n" \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$PARSER_MODULES_DIR" >> "$LOG_FILE" 2>&1
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Another hook-triggered update is already running.
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

now_epoch="$(date +%s)"
if [[ -f "$LAST_RUN_FILE" ]]; then
  last_epoch="$(cat "$LAST_RUN_FILE" 2>/dev/null || echo 0)"
  if [[ "$last_epoch" =~ ^[0-9]+$ ]] && (( now_epoch - last_epoch < MIN_INTERVAL_SEC )); then
    exit 0
  fi
fi

echo "$now_epoch" > "$LAST_RUN_FILE"

{
  printf "[hook] %s start context update\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if bash "$CONTEXT_SCRIPT" update; then
    printf "[hook] %s update ok\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  else
    printf "[hook] %s update failed\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  fi
} >> "$LOG_FILE" 2>&1
