import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolCallHook = (toolName: string, resultCount: number, tokensSaved: number) => void;

export type ToolExecutionPhase = "start" | "success" | "error";

export type ToolExecutionEvent = {
  phase: ToolExecutionPhase;
  tool: string;
  timestamp: string;
  input: Record<string, unknown>;
  query?: string;
  query_length?: number;
  result_count?: number;
  estimated_tokens_saved?: number;
  entities_returned?: string[];
  rules_applied?: string[];
  duration_ms?: number;
  error?: string;
};

export type SessionCallRecord = {
  tool: string;
  query?: string;
  resultCount: number;
  time: string;
  outcome?: "success" | "error";
  duration_ms?: number;
  error?: string;
};

export type SessionEndHook = (calls: SessionCallRecord[]) => Promise<void>;

export type SessionPhase = "start" | "end";

export type SessionEvent = {
  phase: SessionPhase;
  timestamp: string;
  duration_ms?: number;
  tool_calls?: number;
  successful_tool_calls?: number;
  failed_tool_calls?: number;
  calls?: SessionCallRecord[];
};

export type ToolEventHook = (event: ToolExecutionEvent) => void | Promise<void>;
export type SessionEventHook = (event: SessionEvent) => void | Promise<void>;

export type CortexPlugin = {
  name: string;
  version: string;
  register: (server: McpServer) => void | Promise<void>;
  onToolCall?: ToolCallHook;
  onSessionEnd?: SessionEndHook;
  onToolEvent?: ToolEventHook;
  onSessionEvent?: SessionEventHook;
};

export type EditionInfo = {
  edition: "community" | "enterprise";
  name?: string;
  version?: string;
};

let loadedEdition: EditionInfo = { edition: "community" };
let toolCallHook: ToolCallHook | null = null;
let sessionEndHook: SessionEndHook | null = null;
let toolEventHook: ToolEventHook | null = null;
let sessionEventHook: SessionEventHook | null = null;

export function getEdition(): EditionInfo {
  return loadedEdition;
}

export function getToolCallHook(): ToolCallHook | null {
  return toolCallHook;
}

export function getSessionEndHook(): SessionEndHook | null {
  return sessionEndHook;
}

export function getToolEventHook(): ToolEventHook | null {
  return toolEventHook;
}

export function getSessionEventHook(): SessionEventHook | null {
  return sessionEventHook;
}

export async function loadPlugins(server: McpServer): Promise<void> {
  // v2.0.0: enterprise is now in-process. We still gate registration on
  // whether enterprise activation succeeds (license + config), so community
  // users get a no-op when no api_key is present.
  try {
    const enterprise = await import("./enterprise/index.js");
    const { resolveEnterpriseActivation, loadEnterpriseConfig } = await import("./core/config.js");
    const path = await import("node:path");
    const projectRoot = process.env.CORTEX_PROJECT_ROOT?.trim() || process.cwd();
    const contextDir = path.join(projectRoot, ".context");
    const config = loadEnterpriseConfig(contextDir);
    const activation = resolveEnterpriseActivation(config);

    if (!activation.active) {
      // Community mode: no api_key or invalid config. Skip registration.
      return;
    }

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
      if (typeof enterprise.onToolEvent === "function") {
        toolEventHook = enterprise.onToolEvent;
      }
      if (typeof enterprise.onSessionEvent === "function") {
        sessionEventHook = enterprise.onSessionEvent;
      }
      process.stderr.write(`[cortex] Enterprise loaded: ${loadedEdition.version}\n`);
    }
  } catch (error: unknown) {
    process.stderr.write(
      `[cortex] Enterprise activation failed: ${error instanceof Error ? error.message : "unknown error"}\n`
    );
  }
}
