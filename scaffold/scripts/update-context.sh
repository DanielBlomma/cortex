#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[update] ingesting changed files"
"$SCRIPT_DIR/ingest.sh" --changed

echo "[update] embedding changed entities"
if ! "$SCRIPT_DIR/embed.sh" --changed; then
  echo "[update] warning: embedding generation failed; continuing with lexical search fallback"
fi

echo "[update] rebuilding graph"
"$SCRIPT_DIR/load-ryu.sh"

echo "[update] status"
"$SCRIPT_DIR/status.sh"
