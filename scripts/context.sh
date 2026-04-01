#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_help() {
  cat <<'EOF'
Usage: ./scripts/context.sh <command> [options]

Commands:
  bootstrap                        Install deps + full ingest + graph load
  ingest [--changed] [--verbose]   Index docs/code/design context into .context
  embed [--changed]                Generate semantic embeddings for indexed entities
  update                           Ingest changed files + rebuild graph
  watch [start|stop|status|run|once] [--interval <sec>] [--debounce <sec>] [--mode <auto|event|poll>]
                                    Continuous background update loop
  refresh [--changed] [--verbose]  Alias for ingest
  graph-load [--no-reset]          Build RyuGraph DB from indexed context
  note <title> [text]              Save tacit knowledge note into .context/notes
  plan [show|reset]                Show or reset automatic plan/progress state
  todo [text|list|done <id>|reopen <id>|remove <id>]
                                   Manage TODOs in automatic plan state
  dashboard [--interval <sec>]     Live TUI showing what Cortex adds to your repo
  status                           Show latest ingest summary
  help                             Show this message
EOF
}

COMMAND="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

TRACK_EVENT=""

case "$COMMAND" in
  bootstrap)
    "$SCRIPT_DIR/bootstrap.sh" "$@"
    TRACK_EVENT="bootstrap"
    ;;
  ingest)
    "$SCRIPT_DIR/ingest.sh" "$@"
    TRACK_EVENT="ingest"
    ;;
  embed)
    "$SCRIPT_DIR/embed.sh" "$@"
    TRACK_EVENT="embed"
    ;;
  update)
    "$SCRIPT_DIR/update-context.sh" "$@"
    TRACK_EVENT="update"
    ;;
  watch)
    "$SCRIPT_DIR/watch.sh" "$@"
    ;;
  refresh)
    "$SCRIPT_DIR/refresh.sh" "$@"
    TRACK_EVENT="refresh"
    ;;
  graph-load)
    "$SCRIPT_DIR/load-ryu.sh" "$@"
    TRACK_EVENT="graph-load"
    ;;
  note)
    "$SCRIPT_DIR/capture-note.sh" "$@"
    TRACK_EVENT="note"
    ;;
  plan)
    PLAN_SUBCOMMAND="${1:-show}"
    if [[ $# -gt 0 ]]; then
      shift
    fi
    "$SCRIPT_DIR/plan-state.sh" "$PLAN_SUBCOMMAND" "$@"
    ;;
  todo)
    if [[ $# -eq 0 ]]; then
      "$SCRIPT_DIR/plan-state.sh" todo list
    else
      case "$1" in
        list|done|reopen|remove)
          TODO_SUBCOMMAND="$1"
          shift
          "$SCRIPT_DIR/plan-state.sh" todo "$TODO_SUBCOMMAND" "$@"
          ;;
        *)
          "$SCRIPT_DIR/plan-state.sh" todo add "$*"
          ;;
      esac
    fi
    TRACK_EVENT="todo"
    ;;
  dashboard)
    "$SCRIPT_DIR/dashboard.sh" "$@"
    TRACK_EVENT="dashboard"
    ;;
  status)
    "$SCRIPT_DIR/status.sh"
    TRACK_EVENT="status"
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    echo "Unknown command: $COMMAND"
    print_help
    exit 1
    ;;
esac

if [[ -n "$TRACK_EVENT" ]]; then
  if ! "$SCRIPT_DIR/plan-state.sh" event "$TRACK_EVENT" >/dev/null 2>&1; then
    echo "[plan] warning: failed to update plan state"
  fi
fi
