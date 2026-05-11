// Entry point: sets up the MCP server over HTTP, registers the fetch_url and search tools,
// and manages MCP session lifecycle (create, route, close).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { BrowserManager } from './browser-manager.ts';
import { ConnectionManager } from './connection-manager.ts';
import { config } from './config.ts';
import { GoogleSearchBackend } from './search/google.ts';
import { registerSearchBackend, resolveSearchBackend } from './search/registry.ts';
import { fetchUrl } from './tools/fetch-url.ts';
import { runSearch } from './tools/search.ts';
import { logger } from './util/log.ts';

const browserManager = new BrowserManager();
const connectionManager = new ConnectionManager(browserManager);
registerSearchBackend(new GoogleSearchBackend());
resolveSearchBackend(config.searchBackend); // fail fast if SEARCH_BACKEND is not registered
const asStructured = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

const createMcpServer = (): McpServer => {
  const server = new McpServer({ name: 'mcpuppet', version: '0.1.0' });

  server.registerTool(
    'fetch_url',
    {
      description: 'Navigate to URL and return extracted markdown content.',
      inputSchema: z.object({
        url: z.string().url(),
        scroll: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ url, scroll }, extra) => {
      const connectionId = extra.sessionId;
      if (!connectionId) {
        throw new Error('Session ID is required for fetch_url');
      }

      const started = Date.now();
      logger.info({ connectionId, url, scroll: scroll ?? 0 }, 'Tool fetch_url invoked');
      const state = await connectionManager.getOrCreate(connectionId);
      if (!state.page) {
        throw new Error('Failed to create browser page');
      }

      const result = await fetchUrl(state.page, url, scroll);
      logger.info(
        { connectionId, durationMs: Date.now() - started, warnings: result.warnings.length, hasMore: result.hasMore },
        'Tool fetch_url completed',
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: asStructured(result),
      };
    },
  );

  server.registerTool(
    'search',
    {
      description: 'Run web search and return structured results.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().positive().optional(),
      }),
    },
    async ({ query, limit }, extra) => {
      const connectionId = extra.sessionId;
      if (!connectionId) {
        throw new Error('Session ID is required for search');
      }

      const started = Date.now();
      logger.info({ connectionId, queryLength: query.length, requestedLimit: limit }, 'Tool search invoked');
      const state = await connectionManager.getOrCreate(connectionId);
      if (!state.page) {
        throw new Error('Failed to create browser page');
      }

      const backend = resolveSearchBackend(config.searchBackend);
      const result = await runSearch(state.page, query, limit, backend);
      logger.info(
        { connectionId, durationMs: Date.now() - started, backend: result.backend, results: result.results.length, warnings: result.warnings.length },
        'Tool search completed',
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: asStructured(result),
      };
    },
  );

  return server;
};

type SessionContext = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const sessions = new Map<string, SessionContext>();

const app = new Hono();

app.all('/mcp', async (c) => {
  const req = (c.env as { incoming: IncomingMessage }).incoming;
  const res = (c.env as { outgoing: ServerResponse }).outgoing;
  const sessionId = c.req.header('mcp-session-id');

  // After MCP SDK writes directly to res, Hono must not try to write again.
  const sealResponse = () => {
    if (res.headersSent) {
      res.writeHead = (() => res) as typeof res.writeHead;
      res.end = (() => res) as typeof res.end;
    }
  };

  logger.debug({ method: c.req.method, sessionId: sessionId ?? '(none)', sessions: sessions.size }, 'Incoming MCP request');

  try {
    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        logger.warn({ sessionId }, 'Unknown session (server may have restarted), recovering session transparently');

        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });

        transport.onclose = () => {
          sessions.delete(sessionId);
          void connectionManager.onDisconnect(sessionId);
          logger.info({ sessionId, sessions: sessions.size }, 'Recovered MCP session closed');
          void server.close();
        };

        await server.connect(transport);

        // Force the transport into initialized state so it accepts
        // non-initialize requests (e.g. tools/call) from the stale client.
        const webTransport = (transport as unknown as { _webStandardTransport: { _initialized: boolean; sessionId: string } })._webStandardTransport;
        webTransport._initialized = true;
        webTransport.sessionId = sessionId;

        sessions.set(sessionId, { server, transport });
        logger.info({ sessionId, sessions: sessions.size }, 'MCP session recovered');

        await transport.handleRequest(req, res);
        sealResponse();
        return c.body(null);
      }

      logger.debug({ sessionId }, 'Routing to existing transport');
      await existing.transport.handleRequest(req, res);
      sealResponse();
      return c.body(null);
    }

    logger.debug({ sessions: sessions.size }, 'Creating new MCP session');
    let createdTransport: StreamableHTTPServerTransport | undefined;
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { server, transport: createdTransport ?? transport });
        logger.info({ sessionId: newSessionId, sessions: sessions.size }, 'MCP session initialized');
      },
    });
    createdTransport = transport;

    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) {
        sessions.delete(closedSessionId);
        void connectionManager.onDisconnect(closedSessionId);
        logger.info({ sessionId: closedSessionId, sessions: sessions.size }, 'MCP session closed');
      }
      void server.close();
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

const shutdown = async (): Promise<void> => {
  logger.info({ sessions: sessions.size }, 'Shutting down MCPuppet');

  for (const [sessionId, context] of sessions.entries()) {
    await connectionManager.onDisconnect(sessionId);
    await context.transport.close();
    await context.server.close();
    sessions.delete(sessionId);
  }

  await browserManager.shutdown();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await browserManager.launch();
serve({ fetch: app.fetch, hostname: config.host, port: config.port });
logger.info(
  { host: config.host, port: config.port, searchBackend: config.searchBackend, maxConnections: config.maxConnections },
  'McPuppet startup complete',
);
logger.info(`McPuppet listening on http://${config.host}:${config.port}/mcp`);
