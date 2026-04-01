#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/.context/cache/manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "[dashboard] No context data found."
  echo "[dashboard] Run: cortex bootstrap"
  exit 0
fi

exec node "$SCRIPT_DIR/dashboard.mjs" "$@"
