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
  dashboard [--interval <sec>]     Live TUI showing what Cortex adds to your repo
  status                           Show latest ingest summary
  help                             Show this message
EOF
}

COMMAND="${1:-help}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$COMMAND" in
  bootstrap)
    "$SCRIPT_DIR/bootstrap.sh" "$@"
    ;;
  ingest)
    "$SCRIPT_DIR/ingest.sh" "$@"
    ;;
  embed)
    "$SCRIPT_DIR/embed.sh" "$@"
    ;;
  update)
    "$SCRIPT_DIR/update-context.sh" "$@"
    ;;
  watch)
    "$SCRIPT_DIR/watch.sh" "$@"
    ;;
  refresh)
    "$SCRIPT_DIR/refresh.sh" "$@"
    ;;
  graph-load)
    "$SCRIPT_DIR/load-ryu.sh" "$@"
    ;;
  dashboard)
    "$SCRIPT_DIR/dashboard.sh" "$@"
    ;;
  status)
    "$SCRIPT_DIR/status.sh"
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
