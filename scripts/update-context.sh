#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[update] ingesting changed files"
"$REPO_ROOT/scripts/ingest.sh" --changed

echo "[update] embedding changed entities"
if ! "$REPO_ROOT/scripts/embed.sh" --changed; then
  echo "[update] warning: embedding generation failed; continuing with lexical search fallback"
fi

echo "[update] rebuilding graph"
"$REPO_ROOT/scripts/load-ryu.sh"

echo "[update] status"
"$REPO_ROOT/scripts/status.sh"
