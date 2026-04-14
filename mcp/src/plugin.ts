import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolCallHook = (toolName: string, resultCount: number, tokensSaved: number) => void;

export type SessionCallRecord = {
  tool: string;
  query?: string;
  resultCount: number;
  time: string;
};

export type SessionEndHook = (calls: SessionCallRecord[]) => Promise<void>;

export type CortexPlugin = {
  name: string;
  version: string;
  register: (server: McpServer) => void | Promise<void>;
  onToolCall?: ToolCallHook;
  onSessionEnd?: SessionEndHook;
};

export type EditionInfo = {
  edition: "community" | "enterprise";
  name?: string;
  version?: string;
};

let loadedEdition: EditionInfo = { edition: "community" };
let toolCallHook: ToolCallHook | null = null;
let sessionEndHook: SessionEndHook | null = null;

export function getEdition(): EditionInfo {
  return loadedEdition;
}

export function getToolCallHook(): ToolCallHook | null {
  return toolCallHook;
}

export function getSessionEndHook(): SessionEndHook | null {
  return sessionEndHook;
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
      if (typeof enterprise.onToolCall === "function") {
        toolCallHook = enterprise.onToolCall;
      }
      if (typeof enterprise.onSessionEnd === "function") {
        sessionEndHook = enterprise.onSessionEnd;
      }
      process.stderr.write(`[cortex] Enterprise plugin loaded: ${loadedEdition.version}\n`);
    }
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
    ) {
      // Enterprise not installed — community mode
    } else {
      process.stderr.write(
        `[cortex] Enterprise plugin failed to load: ${error instanceof Error ? error.message : "unknown error"}\n`
      );
    }
  }
}
