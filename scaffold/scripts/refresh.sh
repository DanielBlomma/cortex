#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[refresh] running ingestion"
"$SCRIPT_DIR/ingest.sh" "$@"

echo "[refresh] done"
