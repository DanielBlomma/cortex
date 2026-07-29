import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONTEXT_RUNTIME_REL } from "./paths.mjs";

export function resolveProjectRuntimeDist(projectRoot) {
  const target =
    projectRoot ||
    process.env.CORTEX_PROJECT_ROOT?.trim() ||
    process.cwd();
  return path.join(target, CONTEXT_RUNTIME_REL, "dist");
}

export function resolveDaemonEntry(projectRoot) {
  return path.join(resolveProjectRuntimeDist(projectRoot), "daemon", "main.js");
}

export function resolveHookEntry(name) {
  return path.join(resolveProjectRuntimeDist(), "hooks", `${name}.js`);
}

export function resolveCliEntry(name) {
  return path.join(resolveProjectRuntimeDist(), "cli", `${name}.js`);
}

export async function loadProjectCliModule(name) {
  const entry = resolveCliEntry(name);
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Build the project's context runtime first (missing ${entry}). Run 'cortex bootstrap' in the project root.`,
    );
  }
  return import(pathToFileURL(entry).href);
}
