// Type declarations for chrome-devtools-mcp (ships JS only, no .d.ts files).
// Only the subset of the API that mcpuppet uses is declared here.

declare module "chrome-devtools-mcp" {
  import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
  import type { BrowserManager } from "chrome-devtools-mcp/build/src/BrowserManager.js";
  import type { ServerConfig } from "chrome-devtools-mcp/build/src/config/ServerConfig.js";

  export class McpServer {
    /** Create and initialize a server with its own browser connection manager. */
    static from(config: ServerConfig, options: { browserManager: BrowserManager }): Promise<McpServer>;

    /** Connect the server to a transport (stdio, streamable HTTP, etc.). */
    connect(transport: Transport): Promise<void>;

    /** Close the MCP connection and dispose internal resources. */
    close(): Promise<void>;
  }
}

declare module "chrome-devtools-mcp/build/src/config/ServerConfig.js" {
  export class ServerConfig {
    private constructor();

    static create(options: { cliArgs: Record<string, unknown>; fileArgs: Record<string, unknown> }): ServerConfig;

    readonly resolved: Record<string, unknown>;
  }
}

declare module "chrome-devtools-mcp/build/src/BrowserManager.js" {
  import type { ServerConfig } from "chrome-devtools-mcp/build/src/config/ServerConfig.js";

  export class BrowserManager {
    constructor(config: ServerConfig);
    close(): Promise<void>;
  }
}
