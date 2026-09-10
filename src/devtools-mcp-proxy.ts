// Embeds chrome-devtools-mcp as a streamable HTTP endpoint.
// Each MCP session gets its own chrome-devtools-mcp McpServer instance that
// connects to mcpuppet's Chrome via CDP (browserUrl).

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Context } from "hono";

// chrome-devtools-mcp exports its McpServer class from the package root.
// It wraps the SDK McpServer internally and registers all DevTools tools.
import { McpServer as DevToolsMcpServer } from "chrome-devtools-mcp";

import type { BrowserManager } from "./browser-manager.ts";
import { config } from "./config.ts";
import { createLogger } from "./util/log.ts";

const logger = createLogger("devtools");

// Cached after init — the CDP port doesn't change for the lifetime of the Chrome process.
let cachedBrowserUrl: string;

interface DevToolsSessionContext {
  server: DevToolsMcpServer;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, DevToolsSessionContext>();
const sessionIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const recentlyClosedSessions = new Set<string>();
const closingSessions = new Set<string>();

const CLOSED_SESSION_TTL_MS = 30_000;
const RECENTLY_CLOSED_SESSION_LIMIT = 1000;
const CLOSING_SESSION_TIMEOUT_MS = 30_000;

function markSessionClosed(sessionId: string): void {
  const idleTimer = sessionIdleTimers.get(sessionId);
  if (idleTimer) {
    clearTimeout(idleTimer);
    sessionIdleTimers.delete(sessionId);
  }
  if (recentlyClosedSessions.size >= RECENTLY_CLOSED_SESSION_LIMIT) {
    recentlyClosedSessions.delete(recentlyClosedSessions.values().next().value!);
  }
  recentlyClosedSessions.add(sessionId);
  setTimeout(() => recentlyClosedSessions.delete(sessionId), CLOSED_SESSION_TTL_MS).unref();
}

function touchSession(sessionId: string): void {
  const existing = sessionIdleTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  if (config.sessionIdleTimeoutMs <= 0) return;
  const timer = setTimeout(() => {
    sessionIdleTimers.delete(sessionId);
    const ctx = sessions.get(sessionId);
    if (ctx && !closingSessions.has(sessionId)) {
      logger.info({ sessionId }, "DevTools MCP session idle timeout expired, closing");
      void ctx.transport.close();
    }
  }, config.sessionIdleTimeoutMs);
  timer.unref();
  sessionIdleTimers.set(sessionId, timer);
}

/** Wire transport.onclose to clean up the session and close the server. */
function wireOnClose(
  server: DevToolsMcpServer,
  transport: StreamableHTTPServerTransport,
  getSessionId: () => string | undefined,
): void {
  transport.onclose = () => {
    const sessionId = getSessionId();
    if (!sessionId || closingSessions.has(sessionId)) return;
    closingSessions.add(sessionId);
    sessions.delete(sessionId);
    markSessionClosed(sessionId);
    logger.info({ sessionId, sessions: sessions.size }, "DevTools MCP session closed");
    const closeTimeout = setTimeout(() => {
      logger.warn({ sessionId }, "DevTools MCP server.close() timed out");
      closingSessions.delete(sessionId);
    }, CLOSING_SESSION_TIMEOUT_MS);
    server
      .close()
      .catch((err: unknown) => {
        logger.error(
          { sessionId, errorMessage: err instanceof Error ? err.message : String(err) },
          "Error closing DevTools MCP server",
        );
      })
      .finally(() => {
        clearTimeout(closeTimeout);
        closingSessions.delete(sessionId);
      });
  };
}

/** Build the serverArgs object that chrome-devtools-mcp McpServer.from() expects. */
function buildServerArgs(): Record<string, unknown> {
  return {
    browserUrl: cachedBrowserUrl,
    // Disable features that don't apply when embedded.
    usageStatistics: false,
    performanceCrux: false,
    pageIdRouting: true,
    // Don't launch a browser — connect to the existing one.
    headless: false,
    isolated: false,
    // Filesystem access: allow unrestricted paths since we're a local tool server.
    allowUnrestrictedPaths: true,
    // Tool category flags — must be set explicitly because we bypass yargs
    // parsing which would normally apply the defaults.
    categoryInput: true,
    categoryNavigation: true,
    categoryEmulation: true,
    categoryPerformance: true,
    categoryNetwork: true,
    categoryDebugging: true,
    categoryMemory: true,
    // Other flags that gate tool registration.
    javascriptEvaluation: true,
    sourceMaps: true,
  };
}

async function createDevToolsServer(): Promise<DevToolsMcpServer> {
  return await DevToolsMcpServer.from(buildServerArgs());
}

/** Must be called once after browser launch, before handling requests. */
export function initDevToolsMcpProxy(bm: BrowserManager): void {
  const url = bm.browserURL();
  if (!url) {
    throw new Error("Chrome DevTools Protocol URL not available — is Chrome running?");
  }
  cachedBrowserUrl = url;
  logger.debug({ browserUrl: cachedBrowserUrl }, "DevTools MCP proxy initialized");
}

/** Hono route handler for /devtools-mcp */
export async function handleDevToolsMcpRequest(c: Context): Promise<Response> {
  const req = (c.env as { incoming: IncomingMessage }).incoming;
  const res = (c.env as { outgoing: ServerResponse }).outgoing;
  const sessionId = c.req.header("mcp-session-id");

  const sealResponse = () => {
    if (res.headersSent) {
      res.writeHead = () => res;
      res.end = () => res;
    }
  };

  logger.debug(
    { method: c.req.method, sessionId: sessionId ?? "(none)", sessions: sessions.size },
    "Incoming DevTools MCP request",
  );

  try {
    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        if (recentlyClosedSessions.has(sessionId)) {
          logger.debug({ sessionId }, "DevTools MCP: rejecting recovery of recently-closed session");
          return c.json(
            { jsonrpc: "2.0", error: { code: -32600, message: "Session expired, please reinitialize" }, id: null },
            400,
          );
        }

        if (sessions.size >= config.maxConnections) {
          logger.warn({ sessionId, sessions: sessions.size }, "DevTools MCP: rejecting recovery, max connections");
          return c.json(
            { jsonrpc: "2.0", error: { code: -32600, message: "Server at capacity, please retry later" }, id: null },
            503,
          );
        }

        logger.info({ sessionId }, "Reconnecting client to new DevTools MCP session");

        const server = await createDevToolsServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });

        wireOnClose(server, transport, () => sessionId);
        await server.connect(transport);

        // WORKAROUND: Force transport into initialized state for session recovery.
        const webTransport = (
          transport as unknown as { _webStandardTransport: { _initialized: boolean; sessionId: string } }
        )._webStandardTransport;
        if (!webTransport || !("_initialized" in webTransport)) {
          logger.error({ sessionId }, "SDK internals changed — DevTools MCP session recovery unavailable");
          await server.close();
          return c.json(
            { jsonrpc: "2.0", error: { code: -32600, message: "Session expired, please reinitialize" }, id: null },
            400,
          );
        }
        webTransport._initialized = true;
        webTransport.sessionId = sessionId;

        sessions.set(sessionId, { server, transport });
        logger.info({ sessionId, sessions: sessions.size }, "DevTools MCP session recovered");
        touchSession(sessionId);

        await transport.handleRequest(req, res);
        sealResponse();
        return c.body(null);
      }

      touchSession(sessionId);
      await existing.transport.handleRequest(req, res);
      sealResponse();
      return c.body(null);
    }

    // New session
    logger.debug({ sessions: sessions.size }, "Creating new DevTools MCP session");
    const server = await createDevToolsServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { server, transport });
        touchSession(newSessionId);
        logger.info({ sessionId: newSessionId, sessions: sessions.size }, "DevTools MCP session initialized");
      },
    });

    // Use a lazy getter for session ID — at this point the transport hasn't been
    // initialized yet, so transport.sessionId is undefined. The onclose callback
    // reads it when it fires, by which time the session is established.
    wireOnClose(server, transport, () => transport.sessionId);

    await server.connect(transport);
    await transport.handleRequest(req, res);
    sealResponse();
    return c.body(null);
  } catch (error) {
    logger.error(
      { sessionId, errorMessage: error instanceof Error ? error.message : String(error) },
      "DevTools MCP request handling failed",
    );
    sealResponse();
    if (res.headersSent) {
      return c.body(null);
    }
    return c.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      },
      500,
    );
  }
}

/** Shut down all DevTools MCP sessions. Called during server shutdown. */
export async function shutdownDevToolsMcpSessions(): Promise<void> {
  for (const [sessionId, context] of sessions.entries()) {
    try {
      await context.transport.close();
      await context.server.close();
    } catch (err) {
      logger.error(
        { sessionId, errorMessage: err instanceof Error ? err.message : String(err) },
        "Error shutting down DevTools MCP session",
      );
    }
    sessions.delete(sessionId);
  }
}
