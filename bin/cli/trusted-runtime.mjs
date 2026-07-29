import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCAFFOLD_ROOT } from "./paths.mjs";

export function resolveTrustedCliEntry(name) {
  return path.join(SCAFFOLD_ROOT, "mcp", "dist", "cli", `${name}.js`);
}

export function loadGovernModule() {
  const entry = resolveTrustedCliEntry("govern");
  if (!fs.existsSync(entry)) {
    throw new Error(
      `The installed Cortex package is missing its trusted Enterprise runtime (${entry}). Reinstall Cortex.`,
    );
  }
  return import(pathToFileURL(entry).href);
}
