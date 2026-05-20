#!/usr/bin/env bash
# Keep in sync with scripts/memory-compile.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT_DIR="$REPO_ROOT/.context"

printf "[memory-compile] repo: %s\n" "$REPO_ROOT"

if [[ ! -d "$CONTEXT_DIR" ]]; then
  echo "[memory-compile] missing .context/ directory — run cortex init first"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[memory-compile] Node.js is required but not found on PATH"
  exit 1
fi

CORTEX_PROJECT_ROOT="$REPO_ROOT" node "$SCRIPT_DIR/memory-compile.mjs" "$@"
