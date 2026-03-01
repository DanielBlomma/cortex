#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[update] ingesting changed files"
"$REPO_ROOT/scripts/ingest.sh" --changed

echo "[update] rebuilding graph"
"$REPO_ROOT/scripts/load-kuzu.sh"

echo "[update] status"
"$REPO_ROOT/scripts/status.sh"
