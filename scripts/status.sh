#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$REPO_ROOT/.context/cache/manifest.json"
GRAPH_MANIFEST="$REPO_ROOT/.context/cache/graph-manifest.json"
EMBED_MANIFEST="$REPO_ROOT/.context/embeddings/manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "[status] No ingest manifest found."
  echo "[status] Run: ./scripts/context.sh ingest"
  exit 0
fi

node -e '
const fs = require("node:fs");
const manifestPath = process.argv[1];
const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
console.log(`[status] generated_at=${data.generated_at}`);
console.log(`[status] mode=${data.mode}`);
console.log(`[status] source_paths=${(data.source_paths || []).join(", ")}`);
const c = data.counts || {};
console.log(`[status] files=${c.files ?? 0} adrs=${c.adrs ?? 0} rules=${c.rules ?? 0}`);
console.log(`[status] rels constrains=${c.relations_constrains ?? 0} implements=${c.relations_implements ?? 0} supersedes=${c.relations_supersedes ?? 0}`);
const s = data.skipped || {};
console.log(`[status] skipped unsupported=${s.unsupported ?? 0} too_large=${s.too_large ?? s.tooLarge ?? 0} binary=${s.binary ?? 0}`);
if (typeof data.incremental_mode === "boolean") {
  console.log(`[status] incremental_mode=${data.incremental_mode} changed_candidates=${data.changed_candidates ?? 0} deleted_paths=${data.deleted_paths ?? 0}`);
}
' "$MANIFEST"

if [[ -f "$GRAPH_MANIFEST" ]]; then
  node -e '
const fs = require("node:fs");
const graphManifestPath = process.argv[1];
const data = JSON.parse(fs.readFileSync(graphManifestPath, "utf8"));
const c = data.counts || {};
console.log(`[status] graph generated_at=${data.generated_at}`);
console.log(`[status] graph files=${c.files ?? 0} rules=${c.rules ?? 0} adrs=${c.adrs ?? 0}`);
console.log(`[status] graph rels constrains=${c.constrains ?? 0} implements=${c.implements ?? 0} supersedes=${c.supersedes ?? 0}`);
' "$GRAPH_MANIFEST"
else
  echo "[status] graph manifest missing (run: ./scripts/context.sh graph-load)"
fi

if [[ -f "$EMBED_MANIFEST" ]]; then
  node -e '
const fs = require("node:fs");
const embedManifestPath = process.argv[1];
const data = JSON.parse(fs.readFileSync(embedManifestPath, "utf8"));
const c = data.counts || {};
console.log(`[status] embeddings generated_at=${data.generated_at}`);
console.log(`[status] embeddings model=${data.model} dim=${data.dimensions ?? 0}`);
console.log(`[status] embeddings entities=${c.entities ?? 0} output=${c.output ?? 0} embedded=${c.embedded ?? 0} reused=${c.reused ?? 0} failed=${c.failed ?? 0}`);
' "$EMBED_MANIFEST"
else
  echo "[status] embeddings manifest missing (run: ./scripts/context.sh embed)"
fi
