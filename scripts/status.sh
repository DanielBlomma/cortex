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
const parserHealth = data.parser_health || {};
if (parserHealth.csharp) {
  console.log(`[status] csharp_parser available=${parserHealth.csharp.available} files=${parserHealth.csharp.files ?? 0} chunks=${parserHealth.csharp.chunks ?? 0}`);
  if (parserHealth.csharp.reason) {
    console.log(`[status] csharp_parser_reason=${parserHealth.csharp.reason}`);
  }
}
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
const entities = Number(c.entities ?? 0);
const output = Number(c.output ?? 0);
const embedded = Number(c.embedded ?? 0);
const failed = Number(c.failed ?? 0);
console.log(`[status] embeddings generated_at=${data.generated_at}`);
console.log(`[status] embeddings model=${data.model} dim=${data.dimensions ?? 0}`);
console.log(`[status] embeddings entities=${entities} output=${output} embedded=${embedded} reused=${c.reused ?? 0} failed=${failed}`);
if (embedded > 0 && output > 0 && failed === 0) {
  console.log("[status] semantic_search=embedding+lexical (ready)");
} else if (embedded > 0 && output > 0) {
  console.log(`[status] semantic_search=embedding+lexical-partial (failed=${failed})`);
} else if (entities > 0) {
  console.log("[status] semantic_search=lexical-only (run: ./scripts/context.sh embed)");
} else {
  console.log("[status] semantic_search=lexical-only (no indexed entities)");
}
' "$EMBED_MANIFEST"
else
  echo "[status] embeddings manifest missing (run: ./scripts/context.sh embed)"
  echo "[status] semantic_search=lexical-only (embeddings manifest missing)"
fi

node -e '
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const repoRoot = process.argv[1];
const manifestPath = process.argv[2];

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function normalizeSource(sourcePath) {
  const source = toPosixPath(sourcePath).replace(/\/+$/, "");
  if (source === ".") {
    return "";
  }
  return source;
}

function hasSourcePrefix(relPath, sourcePaths) {
  return sourcePaths.some((sourcePath) => {
    const source = normalizeSource(sourcePath);
    if (source === "") {
      return true;
    }
    return relPath === source || relPath.startsWith(`${source}/`);
  });
}

function parseChangedPaths() {
  const output = execSync("git status --porcelain", {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8"
  });

  const changed = new Set();
  const deleted = new Set();

  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine) continue;
    const status = rawLine.slice(0, 2);
    const payload = rawLine.slice(3).trim();
    if (!payload) continue;

    if (payload.includes(" -> ")) {
      const [fromPath, toPath] = payload.split(" -> ");
      deleted.add(path.resolve(repoRoot, fromPath));
      changed.add(path.resolve(repoRoot, toPath));
      continue;
    }

    const absolutePath = path.resolve(repoRoot, payload);
    if (status.includes("D")) {
      deleted.add(absolutePath);
    } else {
      changed.add(absolutePath);
    }
  }

  return { changed, deleted };
}

function createBar(ratio, size = 20) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * size);
  return `[${"#".repeat(filled)}${"-".repeat(size - filled)}]`;
}

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sourcePaths = Array.isArray(manifest.source_paths) ? manifest.source_paths : [];
  const indexedFiles = Number(manifest?.counts?.files ?? 0);

  const { changed, deleted } = parseChangedPaths();
  let relevantChanged = 0;
  let relevantDeleted = 0;

  for (const absolutePath of changed) {
    const relPath = toPosixPath(path.relative(repoRoot, absolutePath));
    if (!relPath || relPath.startsWith("..")) continue;
    if (relPath.startsWith(".context/")) continue;
    if (hasSourcePrefix(relPath, sourcePaths)) {
      relevantChanged += 1;
    }
  }

  for (const absolutePath of deleted) {
    const relPath = toPosixPath(path.relative(repoRoot, absolutePath));
    if (!relPath || relPath.startsWith("..")) continue;
    if (relPath.startsWith(".context/")) continue;
    if (hasSourcePrefix(relPath, sourcePaths)) {
      relevantDeleted += 1;
    }
  }

  const pending = relevantChanged + relevantDeleted;
  const baseline = Math.max(indexedFiles, pending, 1);
  const freshness = Math.max(0, (baseline - pending) / baseline);
  const freshnessPercent = Math.round(freshness * 100);
  const bar = createBar(freshness);

  console.log(`[status] freshness ${bar} ${freshnessPercent}%`);
  if (pending === 0) {
    console.log("[status] update_needed=no");
    console.log("[status] context is up to date with current source changes");
  } else {
    console.log(`[status] update_needed=yes changed=${relevantChanged} deleted=${relevantDeleted}`);
    console.log("[status] run: cortex update");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[status] freshness unavailable (${message})`);
}
' "$REPO_ROOT" "$MANIFEST"

node -e '
const path = require("node:path");
const { execSync } = require("node:child_process");

const repoRoot = process.argv[1];
const cacheDir = process.argv[2];
const localVersionEnv = process.argv[3] || "";

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function getLocalVersion() {
  const envVersion = String(localVersionEnv || "").trim();
  if (parseVersion(envVersion)) {
    return envVersion;
  }

  try {
    const output = execSync("cortex --version", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500
    }).trim();
    if (parseVersion(output)) {
      return output;
    }
  } catch {
    // Ignore and report unavailable below.
  }

  return "";
}

try {
  const localVersion = getLocalVersion();
  if (!localVersion) {
    console.log("[status] cortex_update_check=unavailable (local version not detected)");
    process.exit(0);
  }

  console.log(`[status] cortex_cli_version=${localVersion}`);

  const summarizeError = (error) => {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.split(/\r?\n/)[0].trim();
  };

  const npmCache = path.join(cacheDir, "npm-cache");
  let latestRaw = "";
  try {
    latestRaw = execSync("npm view github:DanielBlomma/cortex version --json", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 2500,
      env: { ...process.env, NPM_CONFIG_CACHE: npmCache }
    }).trim();
  } catch (error) {
    console.log(`[status] cortex_update_check=unavailable (${summarizeError(error)})`);
    process.exit(0);
  }

  const parsedLatest = JSON.parse(latestRaw);
  const latestVersion = Array.isArray(parsedLatest) ? parsedLatest[parsedLatest.length - 1] : parsedLatest;

  const localParsed = parseVersion(localVersion);
  const latestParsed = parseVersion(latestVersion);
  if (!localParsed || !latestParsed) {
    console.log(`[status] cortex_latest_version=${latestVersion}`);
    console.log("[status] cortex_update_check=unavailable (unsupported version format)");
    process.exit(0);
  }

  const hasUpdate = compareVersions(latestParsed, localParsed) > 0;
  console.log(`[status] cortex_latest_version=${latestVersion}`);

  if (hasUpdate) {
    console.log("[status] cortex_update_available=yes");
    console.log("[status] run: npm i -g github:DanielBlomma/cortex");
  } else {
    console.log("[status] cortex_update_available=no");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[status] cortex_update_check=unavailable (${message})`);
}
' "$REPO_ROOT" "$REPO_ROOT/.context/cache" "${CORTEX_CLI_VERSION:-}"
