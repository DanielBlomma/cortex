#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[graph-load] warning: load-kuzu.sh is deprecated; using RyuGraph loader"
"$REPO_ROOT/scripts/load-ryu.sh" "$@"
