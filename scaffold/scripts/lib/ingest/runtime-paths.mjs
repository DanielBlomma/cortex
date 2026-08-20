import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFilesystemBoundary } from "./filesystem-boundary.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_DIR = path.resolve(MODULE_DIR, "..", "..");
const SELECTED_PROJECT_ROOT = process.env.CORTEX_PROJECT_ROOT
  ? path.resolve(process.env.CORTEX_PROJECT_ROOT)
  : path.resolve(SCRIPT_DIR, "..", "..");
export let REPO_ROOT = SELECTED_PROJECT_ROOT;
export let CONTEXT_DIR = path.join(REPO_ROOT, ".context");
export let CACHE_DIR = path.join(CONTEXT_DIR, "cache");
export let DB_IMPORT_DIR = path.join(CONTEXT_DIR, "db", "import");
let projectBoundary = null;

export function initializeRuntimePaths() {
  if (!projectBoundary) {
    projectBoundary = createFilesystemBoundary(SELECTED_PROJECT_ROOT);
    REPO_ROOT = projectBoundary.root;
    CONTEXT_DIR = path.join(REPO_ROOT, ".context");
    CACHE_DIR = path.join(CONTEXT_DIR, "cache");
    DB_IMPORT_DIR = path.join(CONTEXT_DIR, "db", "import");
  }
  return projectBoundary;
}
