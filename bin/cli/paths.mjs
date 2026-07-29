import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(CLI_DIR, "../..");
export const SCAFFOLD_ROOT = path.join(PACKAGE_ROOT, "scaffold");
export const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");

// The project runtime keeps the .context/mcp compatibility name even though
// it now serves the full local context surface.
export const MCP_PROJECT_REL = path.join(".context", "mcp");
export const CONTEXT_RUNTIME_REL = MCP_PROJECT_REL;
export const CONTEXT_SCRIPTS_REL = path.join(".context", "scripts");
