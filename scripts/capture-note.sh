#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTES_DIR="$REPO_ROOT/.context/notes"
DECISIONS_DIR="$REPO_ROOT/.context/decisions"

TITLE="${1:-}"
if [[ -z "$TITLE" ]]; then
  echo "Usage: ./scripts/context.sh note <title> [text]"
  exit 1
fi
shift || true

BODY="${*:-}"
if [[ -z "$BODY" && ! -t 0 ]]; then
  BODY="$(cat)"
fi

mkdir -p "$NOTES_DIR" "$DECISIONS_DIR"

DATE_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DATE_PREFIX="$(date -u +"%Y-%m-%d")"
SLUG="$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')"
if [[ -z "$SLUG" ]]; then
  SLUG="note"
fi
FILE_PATH="$NOTES_DIR/${DATE_PREFIX}-${SLUG}.md"

if [[ -f "$FILE_PATH" ]]; then
  FILE_PATH="$NOTES_DIR/${DATE_PREFIX}-${SLUG}-$(date -u +"%H%M%S").md"
fi

{
  echo "---"
  echo "title: \"$TITLE\""
  echo "created_at: \"$DATE_UTC\""
  echo "kind: \"team-note\""
  echo "source_of_truth: false"
  echo "trust_level: 60"
  echo "status: active"
  echo "---"
  echo
  if [[ -n "$BODY" ]]; then
    echo "$BODY"
  else
    echo "_Skriv ner bakgrund, beslut, edge-cases och länkar här._"
  fi
  echo
  echo "## Follow-up"
  echo "- [ ] Convert to ADR in .context/decisions/ if this becomes a long-term rule."
} > "$FILE_PATH"

echo "[note] wrote $FILE_PATH"
echo "[note] run: ./scripts/context.sh update"
