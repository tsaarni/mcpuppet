// Type declarations for chrome-devtools-mcp (ships JS only, no .d.ts files).
// Only the subset of the API that mcpuppet uses is declared here.

declare module "chrome-devtools-mcp" {
  import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

  export class McpServer {
    /** Create and initialize a McpServer from parsed CLI-style arguments. */
    static from(serverArgs: Record<string, unknown>, options?: Record<string, unknown>): Promise<McpServer>;

    /** Connect the server to a transport (stdio, streamable HTTP, etc.). */
    connect(transport: Transport): Promise<void>;

    /** Close the MCP connection and dispose internal resources. */
    close(): Promise<void>;
  }
}
