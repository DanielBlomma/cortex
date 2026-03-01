#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT_DIR="$REPO_ROOT/.context"

printf "[ingest] repo: %s\n" "$REPO_ROOT"
printf "[ingest] config: %s\n" "$CONTEXT_DIR/config.yaml"

if [[ ! -f "$CONTEXT_DIR/config.yaml" ]]; then
  echo "[ingest] missing .context/config.yaml"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ingest] Node.js is required but not found on PATH"
  exit 1
fi

node "$REPO_ROOT/scripts/ingest.mjs" "$@"
