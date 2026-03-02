#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN_DIR="$REPO_ROOT/.context/plan"
STATE_FILE="$PLAN_DIR/state.json"

SUBCOMMAND="${1:-show}"
if [[ $# -gt 0 ]]; then
  shift
fi

run_state_tool() {
  node "$SCRIPT_DIR/plan-state-engine.cjs" "$STATE_FILE" "$@"
}

mkdir -p "$PLAN_DIR"

case "$SUBCOMMAND" in
  show)
    run_state_tool show
    ;;
  event)
    EVENT_NAME="${1:-}"
    if [[ -z "$EVENT_NAME" ]]; then
      echo "Usage: plan-state.sh event <command-name>"
      exit 1
    fi
    run_state_tool event "$EVENT_NAME"
    ;;
  reset)
    run_state_tool reset
    ;;
  todo)
    TODO_ACTION="${1:-list}"
    if [[ $# -gt 0 ]]; then
      shift
    fi
    run_state_tool todo "$TODO_ACTION" "$*"
    ;;
  *)
    echo "Unknown subcommand: $SUBCOMMAND"
    echo "Usage: plan-state.sh [show|event <name>|reset|todo <action> [args]]"
    exit 1
    ;;
esac
