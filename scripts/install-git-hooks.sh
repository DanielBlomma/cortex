#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "[hooks] missing $HOOKS_DIR"
  exit 1
fi

chmod +x \
  "$HOOKS_DIR/post-commit" \
  "$HOOKS_DIR/post-merge" \
  "$HOOKS_DIR/post-checkout" \
  "$HOOKS_DIR/post-rewrite" \
  "$HOOKS_DIR/_cortex-update-runner.sh"

git -C "$REPO_ROOT" config core.hooksPath .githooks

echo "[hooks] installed core.hooksPath=.githooks"
echo "[hooks] post-checkout + post-merge + post-commit + post-rewrite now trigger background cortex update"
echo "[hooks] logs: .context/hooks/update.log"
