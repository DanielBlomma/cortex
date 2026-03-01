#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[refresh] running ingestion"
"$REPO_ROOT/scripts/ingest.sh" "$@"

echo "[refresh] done"
