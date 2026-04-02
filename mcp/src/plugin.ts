import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type CortexPlugin = {
  name: string;
  version: string;
  register: (server: McpServer) => void | Promise<void>;
};

export type EditionInfo = {
  edition: "community" | "enterprise";
  name?: string;
  version?: string;
};

let loadedEdition: EditionInfo = { edition: "community" };

export function getEdition(): EditionInfo {
  return loadedEdition;
}

export async function loadPlugins(server: McpServer): Promise<void> {
  try {
    const enterprise = await import("@danielblomma/cortex-enterprise");
    if (typeof enterprise.register === "function") {
      await enterprise.register(server);
      loadedEdition = {
        edition: "enterprise",
        name: enterprise.name ?? "enterprise",
        version: enterprise.version ?? "unknown",
      };
      process.stderr.write(`[cortex] Enterprise plugin loaded: ${loadedEdition.version}\n`);
    }
  } catch {
    // Enterprise not installed — community mode
  }
}
