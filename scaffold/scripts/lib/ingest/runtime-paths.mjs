import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT_DIR = path.resolve(MODULE_DIR, "..", "..");
export const REPO_ROOT = process.env.CORTEX_PROJECT_ROOT
  ? path.resolve(process.env.CORTEX_PROJECT_ROOT)
  : path.resolve(SCRIPT_DIR, "..", "..");
export const CONTEXT_DIR = path.join(REPO_ROOT, ".context");
export const CACHE_DIR = path.join(CONTEXT_DIR, "cache");
export const DB_IMPORT_DIR = path.join(CONTEXT_DIR, "db", "import");
