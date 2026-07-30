import path from "node:path";
import { loadProjectCliModule } from "./project-runtime.mjs";

export const QUERY_COMMANDS = new Set([
  "search",
  "related",
  "impact",
  "rules",
  "explain",
  "pattern-evidence",
]);

export async function runQueryCommandShim(command, args) {
  const target = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
  process.env.CORTEX_PROJECT_ROOT = path.resolve(target);
  const mod = await loadProjectCliModule("query");
  await mod.runQueryCommand([command, ...args]);
}
