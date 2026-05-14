// Entry point: sets up the MCP server over HTTP, registers the fetch_url and search tools,
// and manages MCP session lifecycle (create, route, close).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { BrowserManager } from './browser-manager.ts';
import { ConnectionManager } from './connection-manager.ts';
import { config } from './config.ts';
import { GoogleSearchBackend } from './search/google-search.ts';
import { registerSearchBackend, resolveSearchBackend } from './search/registry.ts';
import { register as registerFetchUrl } from './tools/fetch-url.ts';
import { register as registerSearch } from './tools/search.ts';
import { logger } from './util/log.ts';

const browserManager = new BrowserManager();
const connectionManager = new ConnectionManager(browserManager);
registerSearchBackend(new GoogleSearchBackend());
resolveSearchBackend(config.searchBackend); // fail fast if SEARCH_BACKEND is not registered

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'mcpuppet', version: '0.1.0' });

  registerFetchUrl(server, connectionManager);
  registerSearch(server, connectionManager, () => resolveSearchBackend(config.searchBackend));

  return server;
}

interface SessionContext {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, SessionContext>();
const sessionIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Tracks session IDs that were recently closed to prevent infinite recovery loops.
// When a stale client keeps retrying with the same session ID, without this guard
// the server would recover → close → recover → close in a tight loop until OOM.
const recentlyClosedSessions = new Set<string>();
const CLOSED_SESSION_TTL_MS = 30000;

const RECENTLY_CLOSED_SESSION_LIMIT = 1000;

function markSessionClosed(sessionId: string): void {
  const idleTimer = sessionIdleTimers.get(sessionId);
  if (idleTimer) { clearTimeout(idleTimer); sessionIdleTimers.delete(sessionId); }
  if (recentlyClosedSessions.size >= RECENTLY_CLOSED_SESSION_LIMIT) {
    recentlyClosedSessions.delete(recentlyClosedSessions.values().next().value!);
  }
  recentlyClosedSessions.add(sessionId);
  setTimeout(() => recentlyClosedSessions.delete(sessionId), CLOSED_SESSION_TTL_MS);
}

// Guards against re-entrant onclose calls. server.close() triggers transport.close()
// which fires onclose again, causing infinite recursion without this guard.
const closingSessions = new Set<string>();
const CLOSING_SESSION_TIMEOUT_MS = 30_000;

/** Resets the idle timer for a session. Closes the session if no activity within the timeout. */
function touchSession(sessionId: string): void {
  const existing = sessionIdleTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  if (config.sessionIdleTimeoutMs <= 0) return;
  const timer = setTimeout(() => {
    sessionIdleTimers.delete(sessionId);
    const ctx = sessions.get(sessionId);
    if (ctx && !closingSessions.has(sessionId)) {
      logger.info({ sessionId }, 'Session idle timeout expired, closing');
      void ctx.transport.close();
    }
  }, config.sessionIdleTimeoutMs);
  timer.unref();
  sessionIdleTimers.set(sessionId, timer);
}

const app = new Hono();

app.use('*', async (c, next) => {
  if (config.authToken) {
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${config.authToken}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }
  await next();
});

app.all('/mcp', async (c) => {
  const req = (c.env as { incoming: IncomingMessage }).incoming;
  const res = (c.env as { outgoing: ServerResponse }).outgoing;
  const sessionId = c.req.header('mcp-session-id');

  // After MCP SDK writes directly to res, Hono must not try to write again.
  const sealResponse = () => {
    if (res.headersSent) {
      res.writeHead = () => res;
      res.end = () => res;
    }
  };

  logger.debug({ method: c.req.method, sessionId: sessionId ?? '(none)', sessions: sessions.size }, 'Incoming MCP request');

  try {
    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        if (recentlyClosedSessions.has(sessionId)) {
          logger.debug({ sessionId }, 'Rejecting recovery of recently-closed session');
          return c.json(
            { jsonrpc: '2.0', error: { code: -32600, message: 'Session expired, please reinitialize' }, id: null },
            400,
          );
        }

        if (sessions.size >= config.maxConnections) {
          logger.warn({ sessionId, sessions: sessions.size }, 'Rejecting recovery: max connections reached');
          return c.json(
            { jsonrpc: '2.0', error: { code: -32600, message: 'Server at capacity, please retry later' }, id: null },
            503,
          );
        }

        logger.warn({ sessionId }, 'Unknown session (server may have restarted), recovering session transparently');

        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });

        transport.onclose = () => {
          if (closingSessions.has(sessionId)) return;
          closingSessions.add(sessionId);
          sessions.delete(sessionId);
          markSessionClosed(sessionId);
          connectionManager.onDisconnect(sessionId).catch((err) => {
            logger.error(
              { sessionId, errorMessage: err instanceof Error ? err.message : String(err) },
              'Error disconnecting recovered session',
            );
          });
          logger.info({ sessionId, sessions: sessions.size }, 'Recovered MCP session closed');
          const closeTimeout = setTimeout(() => {
            logger.warn({ sessionId }, 'server.close() timed out, releasing closingSessions guard');
            closingSessions.delete(sessionId);
          }, CLOSING_SESSION_TIMEOUT_MS);
          server.close().catch((err) => {
            logger.error(
              { sessionId, errorMessage: err instanceof Error ? err.message : String(err) },
              'Error closing recovered MCP server',
            );
          }).finally(() => { clearTimeout(closeTimeout); closingSessions.delete(sessionId); });
        };

        await server.connect(transport);

        // WORKAROUND: Force the transport into initialized state so it accepts
        // non-initialize requests (e.g. tools/call) from the stale client.
        // This patches undocumented SDK internals — any SDK update can break it.
        // A public API (sessionId constructor option) is proposed upstream:
        // https://github.com/modelcontextprotocol/typescript-sdk/pull/1786
        const webTransport = (transport as unknown as { _webStandardTransport: { _initialized: boolean; sessionId: string } })._webStandardTransport;
        if (!webTransport || !('_initialized' in webTransport)) {
          logger.error({ sessionId }, 'SDK internals changed — session recovery unavailable');
          return c.json(
            { jsonrpc: '2.0', error: { code: -32600, message: 'Session expired, please reinitialize' }, id: null },
            400,
          );
        }
        webTransport._initialized = true;
        webTransport.sessionId = sessionId;

        sessions.set(sessionId, { server, transport });
        logger.info({ sessionId, sessions: sessions.size }, 'MCP session recovered');
        touchSession(sessionId);

        await transport.handleRequest(req, res);
        sealResponse();
        return c.body(null);
      }

      logger.debug({ sessionId }, 'Routing to existing transport');

      // Session lifetime is NOT tied to SSE stream — clients may reconnect freely.
      touchSession(sessionId);

      await existing.transport.handleRequest(req, res);
      sealResponse();
      return c.body(null);
    }

    logger.debug({ sessions: sessions.size }, 'Creating new MCP session');
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { server, transport });
        touchSession(newSessionId);
        logger.info({ sessionId: newSessionId, sessions: sessions.size }, 'MCP session initialized');
      },
    });

    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) {
        if (closingSessions.has(closedSessionId)) return;
        closingSessions.add(closedSessionId);
        sessions.delete(closedSessionId);
        markSessionClosed(closedSessionId);
        connectionManager.onDisconnect(closedSessionId).catch((err) => {
          logger.error(
            { sessionId: closedSessionId, errorMessage: err instanceof Error ? err.message : String(err) },
            'Error disconnecting session',
          );
        });
        logger.info({ sessionId: closedSessionId, sessions: sessions.size }, 'MCP session closed');
      }
      const closeTimeout = setTimeout(() => {
        logger.warn({ sessionId: closedSessionId }, 'server.close() timed out, releasing closingSessions guard');
        if (closedSessionId) closingSessions.delete(closedSessionId);
      }, CLOSING_SESSION_TIMEOUT_MS);
      server.close().catch((err) => {
        logger.error(
          { errorMessage: err instanceof Error ? err.message : String(err) },
          'Error closing MCP server',
        );
      }).finally(() => { clearTimeout(closeTimeout); if (closedSessionId) closingSessions.delete(closedSessionId); });
    };

    await server.connect(transport);
    logger.debug('New transport connected, handling request');
    await transport.handleRequest(req, res);
    sealResponse();
    logger.debug('New transport handled request');
    return c.body(null);
  } catch (error) {
    logger.error(
      { sessionId, errorMessage: error instanceof Error ? error.message : String(error) },
      'Request handling failed',
    );
    sealResponse();
    if (res.headersSent) {
      return c.body(null);
    }
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      },
      500,
    );
  }
});

async function shutdown(): Promise<void> {
  logger.info({ sessions: sessions.size }, 'Shutting down MCPuppet');

  for (const [sessionId, context] of sessions.entries()) {
    await connectionManager.onDisconnect(sessionId);
    await context.transport.close();
    await context.server.close();
    sessions.delete(sessionId);
  }

  await browserManager.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await browserManager.launch();
serve({ fetch: app.fetch, hostname: config.host, port: config.port });
logger.info(
  { host: config.host, port: config.port, searchBackend: config.searchBackend, maxConnections: config.maxConnections },
  'McPuppet startup complete',
);
logger.info(`McPuppet listening on http://${config.host}:${config.port}/mcp`);
if (!config.authToken) {
  logger.warn('No MCPUPPET_AUTH_TOKEN set — server is unauthenticated. Intended for localhost use only.');
}
