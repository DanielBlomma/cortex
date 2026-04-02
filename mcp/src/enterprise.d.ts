declare module "@danielblomma/cortex-enterprise" {
  import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
  export const name: string;
  export const version: string;
  export function register(server: McpServer): void | Promise<void>;
}
