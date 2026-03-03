#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_DIR="$REPO_ROOT/.context/watch"
PID_FILE="$WATCH_DIR/watch.pid"
STAMP_FILE="$WATCH_DIR/last-stamp.sha1"
HEARTBEAT_FILE="$WATCH_DIR/heartbeat.txt"
LOG_FILE="$WATCH_DIR/watch.log"
MODE_FILE="$WATCH_DIR/mode.txt"

ACTION="${1:-status}"
if [[ $# -gt 0 ]]; then
  shift
fi

INTERVAL_SEC="${CORTEX_WATCH_INTERVAL:-45}"
DEBOUNCE_SEC="${CORTEX_WATCH_DEBOUNCE:-8}"
WATCH_MODE="${CORTEX_WATCH_MODE:-auto}"
EVENT_BACKEND=""

print_usage() {
  cat <<'USAGE'
Usage: ./scripts/watch.sh [start|stop|status|run|once] [--interval <sec>] [--debounce <sec>] [--mode <auto|event|poll>]

Commands:
  start     Start background watch loop
  stop      Stop running watch loop
  status    Show running status
  run       Run loop in foreground
  once      Run one immediate cortex update
USAGE
}

ensure_number() {
  local raw="$1"
  local name="$2"
  if ! [[ "$raw" =~ ^[0-9]+$ ]] || [[ "$raw" -lt 1 ]]; then
    echo "[watch] $name must be a positive integer (got '$raw')"
    exit 1
  fi
}

ensure_mode() {
  case "$1" in
    auto|event|poll)
      ;;
    *)
      echo "[watch] mode must be one of: auto|event|poll (got '$1')"
      exit 1
      ;;
  esac
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

detect_event_backend() {
  if command -v inotifywait >/dev/null 2>&1; then
    echo "inotifywait"
    return 0
  fi

  if command -v fswatch >/dev/null 2>&1; then
    echo "fswatch"
    return 0
  fi

  return 1
}

resolve_mode() {
  case "$WATCH_MODE" in
    auto)
      if EVENT_BACKEND="$(detect_event_backend)"; then
        WATCH_MODE="event"
      else
        WATCH_MODE="poll"
        EVENT_BACKEND=""
      fi
      ;;
    event)
      EVENT_BACKEND="$(detect_event_backend || true)"
      if [[ -z "$EVENT_BACKEND" ]]; then
        echo "[watch] mode=event requested but no event backend found"
        echo "[watch] install inotifywait (Linux) or fswatch (macOS), or use --mode poll"
        exit 1
      fi
      ;;
    poll)
      EVENT_BACKEND=""
      ;;
  esac
}

status_digest() {
  if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local head_commit
    local head_ref
    head_commit="$(git -C "$REPO_ROOT" rev-parse --verify HEAD 2>/dev/null || echo "NO_HEAD")"
    head_ref="$(git -C "$REPO_ROOT" symbolic-ref --short -q HEAD 2>/dev/null || echo "DETACHED")"

    {
      printf 'HEAD:%s\n' "$head_commit"
      printf 'REF:%s\n' "$head_ref"
      git -C "$REPO_ROOT" status --porcelain=1 --untracked-files=all \
        | awk '
          {
            path = substr($0, 4);
            if (path ~ /^\.context\//) next;
            if (path ~ /^mcp\/node_modules\//) next;
            if (path ~ /^mcp\/dist\//) next;
            if (path ~ /^mcp\/\.npm-cache\//) next;
            if (path ~ /^scripts\/parsers\/node_modules\//) next;
            if (path ~ /^scripts\/parsers\/\.npm-cache\//) next;
            print $0;
          }
        '
    } \
      | shasum -a 1 \
      | awk '{print $1}'
    return
  fi

  # Fallback for non-git directories.
  find "$REPO_ROOT" -type f \
    ! -path "$REPO_ROOT/.context/*" \
    ! -path "$REPO_ROOT/mcp/node_modules/*" \
    ! -path "$REPO_ROOT/mcp/dist/*" \
    ! -path "$REPO_ROOT/mcp/.npm-cache/*" \
    ! -path "$REPO_ROOT/scripts/parsers/node_modules/*" \
    ! -path "$REPO_ROOT/scripts/parsers/.npm-cache/*" \
    -print \
    | LC_ALL=C sort \
    | shasum -a 1 \
    | awk '{print $1}'
}

run_update() {
  local start_ts
  start_ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "[watch] update start at $start_ts"

  if bash "$REPO_ROOT/scripts/context.sh" update; then
    echo "[watch] update success"
    return 0
  fi

  echo "[watch] update failed"
  return 1
}

maybe_run_update() {
  local previous_digest="$1"

  sleep "$DEBOUNCE_SEC"
  local settled_digest
  settled_digest="$(status_digest)"

  if [[ "$settled_digest" == "$previous_digest" ]]; then
    echo "$previous_digest"
    return 0
  fi

  if run_update; then
    :
  else
    # Move forward anyway to avoid tight retry loops on persistent failures.
    :
  fi

  echo "$settled_digest" > "$STAMP_FILE"
  echo "$settled_digest"
}

wait_for_change_event() {
  case "$EVENT_BACKEND" in
    inotifywait)
      inotifywait -q -r \
        -e modify,create,delete,move \
        --exclude '(^|/)\\.git(/|$)|(^|/)\\.context(/|$)|(^|/)mcp/(node_modules|dist|\\.npm-cache)(/|$)|(^|/)scripts/parsers/(node_modules|\\.npm-cache)(/|$)' \
        "$REPO_ROOT" >/dev/null 2>&1 || true
      ;;
    fswatch)
      fswatch -1 -r \
        --exclude '(^|/)\\.git(/|$)' \
        --exclude '(^|/)\\.context(/|$)' \
        --exclude '(^|/)mcp/node_modules(/|$)' \
        --exclude '(^|/)mcp/dist(/|$)' \
        --exclude '(^|/)mcp/\\.npm-cache(/|$)' \
        --exclude '(^|/)scripts/parsers/node_modules(/|$)' \
        --exclude '(^|/)scripts/parsers/\\.npm-cache(/|$)' \
        "$REPO_ROOT" >/dev/null 2>&1 || true
      ;;
    *)
      echo "[watch] internal error: missing event backend"
      exit 1
      ;;
  esac
}

run_poll_loop() {
  local previous_digest="$1"

  while true; do
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$HEARTBEAT_FILE"
    local current_digest
    current_digest="$(status_digest)"

    if [[ "$current_digest" != "$previous_digest" ]]; then
      echo "[watch] change detected, waiting ${DEBOUNCE_SEC}s"
      previous_digest="$(maybe_run_update "$previous_digest")"
    fi

    sleep "$INTERVAL_SEC"
  done
}

run_event_loop() {
  local previous_digest="$1"

  while true; do
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$HEARTBEAT_FILE"
    wait_for_change_event
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$HEARTBEAT_FILE"
    echo "[watch] change event detected, waiting ${DEBOUNCE_SEC}s"
    previous_digest="$(maybe_run_update "$previous_digest")"
  done
}

run_loop() {
  mkdir -p "$WATCH_DIR"

  local previous_digest
  if [[ -f "$STAMP_FILE" ]]; then
    previous_digest="$(cat "$STAMP_FILE" 2>/dev/null || true)"
  else
    previous_digest="$(status_digest)"
    echo "$previous_digest" > "$STAMP_FILE"
  fi

  resolve_mode
  local backend_label
  backend_label="${EVENT_BACKEND:-none}"
  printf 'mode=%s\nbackend=%s\ninterval=%s\ndebounce=%s\n' "$WATCH_MODE" "$backend_label" "$INTERVAL_SEC" "$DEBOUNCE_SEC" > "$MODE_FILE"
  echo "[watch] running (mode=${WATCH_MODE} backend=${backend_label} interval=${INTERVAL_SEC}s debounce=${DEBOUNCE_SEC}s)"

  if [[ "$WATCH_MODE" == "event" ]]; then
    run_event_loop "$previous_digest"
    return
  fi

  run_poll_loop "$previous_digest"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      INTERVAL_SEC="${2:-}"
      shift 2
      ;;
    --debounce)
      DEBOUNCE_SEC="${2:-}"
      shift 2
      ;;
    --mode)
      WATCH_MODE="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

ensure_number "$INTERVAL_SEC" "interval"
ensure_number "$DEBOUNCE_SEC" "debounce"
ensure_mode "$WATCH_MODE"
mkdir -p "$WATCH_DIR"

case "$ACTION" in
  start)
    if is_running; then
      echo "[watch] already running (pid $(cat "$PID_FILE"))"
      exit 0
    fi

    nohup bash "$0" run --interval "$INTERVAL_SEC" --debounce "$DEBOUNCE_SEC" --mode "$WATCH_MODE" >> "$LOG_FILE" 2>&1 &
    WATCH_PID=$!
    echo "$WATCH_PID" > "$PID_FILE"
    sleep 1

    if kill -0 "$WATCH_PID" >/dev/null 2>&1; then
      echo "[watch] started (pid $WATCH_PID)"
      echo "[watch] log: $LOG_FILE"
      exit 0
    fi

    echo "[watch] failed to start"
    exit 1
    ;;

  stop)
    if ! is_running; then
      rm -f "$PID_FILE"
      echo "[watch] not running"
      exit 0
    fi

    WATCH_PID="$(cat "$PID_FILE")"
    kill "$WATCH_PID" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$WATCH_PID" >/dev/null 2>&1; then
      kill -9 "$WATCH_PID" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
    echo "[watch] stopped"
    ;;

  status)
    if is_running; then
      echo "[watch] running (pid $(cat "$PID_FILE"))"
      echo "[watch] log: $LOG_FILE"
      if [[ -f "$MODE_FILE" ]]; then
        local_mode="$(tr '\n' ' ' < "$MODE_FILE" | sed 's/[[:space:]]\+$//')"
        echo "[watch] $local_mode"
      fi
      if [[ -f "$HEARTBEAT_FILE" ]]; then
        echo "[watch] heartbeat: $(cat "$HEARTBEAT_FILE")"
      fi
    else
      echo "[watch] stopped"
    fi
    ;;

  run)
    run_loop
    ;;

  once)
    run_update
    ;;

  help|-h|--help)
    print_usage
    ;;

  *)
    echo "Unknown command: $ACTION"
    print_usage
    exit 1
    ;;
esac
