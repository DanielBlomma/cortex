#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
process.env.CORTEX_PROJECT_ROOT = REPO_ROOT;

const runtimeDist = path.join(REPO_ROOT, ".context", "mcp", "dist");
const [{ loadContextData }, { buildAndPersistConventionProfiles }] = await Promise.all([
  import(pathToFileURL(path.join(runtimeDist, "graph.js")).href),
  import(pathToFileURL(path.join(runtimeDist, "conventions.js")).href),
]);
const result = await buildAndPersistConventionProfiles({ data: await loadContextData() });
console.log(
  `[conventions] profiles=${result.manifest.profiles.length} changed=${result.changed_profile_ids.length} unchanged=${result.unchanged_profile_ids.length} removed=${result.removed_profile_ids.length}`,
);
