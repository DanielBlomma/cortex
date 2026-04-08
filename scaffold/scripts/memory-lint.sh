#!/usr/bin/env bash
# Keep in sync with scripts/memory-lint.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT_DIR="$REPO_ROOT/.context"

printf "[memory-lint] repo: %s\n" "$REPO_ROOT"

if [[ ! -d "$CONTEXT_DIR" ]]; then
  echo "[memory-lint] missing .context/ directory — run cortex init first"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[memory-lint] Node.js is required but not found on PATH"
  exit 1
fi

node "$REPO_ROOT/scripts/memory-lint.mjs" "$@"
