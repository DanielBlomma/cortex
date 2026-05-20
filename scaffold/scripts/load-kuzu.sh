#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[graph-load] warning: load-kuzu.sh is deprecated; using RyuGraph loader"
"$SCRIPT_DIR/load-ryu.sh" "$@"
