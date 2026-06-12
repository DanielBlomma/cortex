#!/usr/bin/env bash
# Entry point executed inside the bootstrapbench container for one
# (repo x embedding model) eval item:
#   clone pinned commit -> cortex init -> seed warm caches -> cortex bootstrap
#   -> extract stats into the mounted output directory.
#
# Required env: BB_REPO_URL, BB_REPO_SHA, BB_REPO_KEY
# Optional env: BB_META_JSON (orchestrator metadata), CORTEX_EMBED_MODEL,
#               BB_OUT (default /out)
set -uo pipefail

: "${BB_REPO_URL:?BB_REPO_URL is required}"
: "${BB_REPO_SHA:?BB_REPO_SHA is required}"
: "${BB_REPO_KEY:?BB_REPO_KEY is required}"
BB_OUT="${BB_OUT:-/out}"
# Note: ${VAR:-{}} would terminate the expansion at the first '}' and append
# a stray brace to the JSON, so default the empty case explicitly.
if [ -z "${BB_META_JSON:-}" ]; then
  BB_META_JSON='{}'
fi
export BB_META_JSON

HARNESS=/opt/bootstrapbench
WARM=/opt/cortex/warm-context
WORKSPACE=/workspace/repo
META=/tmp/meta.json
TIMINGS=/tmp/timings.json

mkdir -p "$BB_OUT" "$WORKSPACE"
echo '{}' > "$TIMINGS"

emit_error_stats() {
  local message="$1"
  node "$HARNESS/extract-stats.mjs" \
    --project "$WORKSPACE" --out "$BB_OUT/stats.json" \
    --meta "$META" --timings "$TIMINGS" \
    --status-override error --error "$message" || true
}

fail() {
  local message="$1"
  echo "[container-run] FATAL: $message" >&2
  emit_error_stats "$message"
  exit 1
}

echo "[container-run] repo=$BB_REPO_KEY sha=$BB_REPO_SHA model=${CORTEX_EMBED_MODEL:-default}"

node -e '
  const fs = require("node:fs");
  const meta = JSON.parse(process.env.BB_META_JSON || "{}");
  fs.writeFileSync("/tmp/meta.json", JSON.stringify(meta));
' || fail "BB_META_JSON is not valid JSON"

# 1. Materialize the pinned commit. Shallow fetch by sha works on GitHub; fall
#    back to a full fetch for remotes that refuse unadvertised objects.
git -C "$WORKSPACE" init -q || fail "git init failed"
git -C "$WORKSPACE" remote add origin "$BB_REPO_URL" || fail "git remote add failed"
if ! git -C "$WORKSPACE" fetch -q --depth 1 origin "$BB_REPO_SHA" 2>/tmp/fetch.log; then
  echo "[container-run] shallow fetch by sha failed; retrying full fetch"
  git -C "$WORKSPACE" fetch -q origin 2>>/tmp/fetch.log || fail "git fetch failed: $(tail -3 /tmp/fetch.log | tr '\n' ' ')"
fi
git -C "$WORKSPACE" -c advice.detachedHead=false checkout -q "$BB_REPO_SHA" \
  || fail "git checkout $BB_REPO_SHA failed"

# 2. Workspace size from git metadata (count + blob bytes of tracked files),
#    plus total newline count across all tracked blobs as the repo's raw LOC
#    (binary blobs contribute whatever newlines they contain; this is the
#    standard rough denominator, used for the cortex-coverage ratio).
read -r TRACKED_FILES TRACKED_BYTES <<<"$(git -C "$WORKSPACE" ls-tree -r -l HEAD \
  | awk '$4 ~ /^[0-9]+$/ { files += 1; bytes += $4 } END { printf "%d %d", files, bytes }')"
TRACKED_LINES=$(cd "$WORKSPACE" && git ls-files -z | xargs -0 -n 200 cat 2>/dev/null | wc -l | tr -d ' ')
export TRACKED_FILES TRACKED_BYTES TRACKED_LINES
node -e '
  const fs = require("node:fs");
  const meta = JSON.parse(fs.readFileSync("/tmp/meta.json", "utf8"));
  meta.workspace = {
    ...(meta.workspace ?? {}),
    tracked_files: Number(process.env.TRACKED_FILES),
    tracked_bytes: Number(process.env.TRACKED_BYTES),
    tracked_lines: Number(process.env.TRACKED_LINES)
  };
  fs.writeFileSync("/tmp/meta.json", JSON.stringify(meta));
' || fail "failed to record workspace stats"
echo "[container-run] tracked_files=$TRACKED_FILES tracked_bytes=$TRACKED_BYTES tracked_lines=$TRACKED_LINES"

# 3. Scaffold cortex into the repo (source path auto-detection happens here).
#    --no-connect/--no-watch keep the run deterministic: no MCP client probing
#    and no background watch daemon competing with the timed bootstrap.
#    --force handles repos that already track a .context/ (cortex's own repo
#    does); init still preserves a repo's committed config.yaml, which is the
#    representative behavior for such projects.
cortex init "$WORKSPACE" --force --no-connect --no-watch > "$BB_OUT/init.log" 2>&1 \
  || fail "cortex init failed: $(tail -5 "$BB_OUT/init.log" | tr '\n' ' ')"

# 4. Seed caches warmed at image build time so each run skips npm installs and
#    the default embedding model download. Missing seeds just mean a slow path.
#    seed_dir replaces the destination outright: `cp -R src dst` would nest
#    src inside dst whenever dst already exists.
seed_dir() {
  local source="$1" destination="$2"
  if [ -d "$source" ]; then
    rm -rf "$destination"
    mkdir -p "$(dirname "$destination")"
    cp -R "$source" "$destination"
  fi
}
seed_dir "$WARM/mcp/node_modules" "$WORKSPACE/.context/mcp/node_modules"
seed_dir "$WARM/mcp/dist" "$WORKSPACE/.context/mcp/dist"
seed_dir "$WARM/parsers-node_modules" "$WORKSPACE/.context/scripts/parsers/node_modules"
seed_dir "$WARM/embeddings-models" "$WORKSPACE/.context/embeddings/models"

# 5. Bootstrap with per-phase timing capture.
node "$HARNESS/docker/run-bootstrap.mjs" \
  --project "$WORKSPACE" --log "$BB_OUT/bootstrap.log" --timings "$TIMINGS"
BOOTSTRAP_EXIT=$?

# 6. Extract stats; on bootstrap failure still record whatever exists.
if [ "$BOOTSTRAP_EXIT" -ne 0 ]; then
  echo "[container-run] bootstrap failed with exit $BOOTSTRAP_EXIT" >&2
  emit_error_stats "cortex bootstrap exited with code $BOOTSTRAP_EXIT"
  exit "$BOOTSTRAP_EXIT"
fi

node "$HARNESS/extract-stats.mjs" \
  --project "$WORKSPACE" --out "$BB_OUT/stats.json" \
  --meta "$META" --timings "$TIMINGS" \
  || fail "stats extraction failed"

echo "[container-run] done"
