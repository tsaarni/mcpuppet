// Integration tests for MCP Streamable HTTP session lifecycle.
// Verifies spec compliance: session creation, SSE stream independence, session recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

// --- Minimal server setup (mirrors main.ts session logic without browser/tools) ---

interface SessionContext {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function createTestServer() {
  const sessions = new Map<string, SessionContext>();
  const recentlyClosedSessions = new Set<string>();
  const closingSessions = new Set<string>();
  const sessionIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const MAX_CONNECTIONS = 2;
  const IDLE_TIMEOUT_MS = 500;

  function touchSession(sessionId: string): void {
    const existing = sessionIdleTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      sessionIdleTimers.delete(sessionId);
      const ctx = sessions.get(sessionId);
      if (ctx && !closingSessions.has(sessionId)) {
        void ctx.transport.close();
      }
    }, IDLE_TIMEOUT_MS);
    timer.unref();
    sessionIdleTimers.set(sessionId, timer);
  }

  function createMcpServer(): McpServer {
    return new McpServer({ name: 'test-server', version: '0.0.1' });
  }

  const app = new Hono();

  app.all('/mcp', async (c) => {
    const req = (c.env as { incoming: IncomingMessage }).incoming;
    const res = (c.env as { outgoing: ServerResponse }).outgoing;
    const sessionId = c.req.header('mcp-session-id');

    const sealResponse = () => {
      if (res.headersSent) {
        res.writeHead = () => res;
        res.end = () => res;
      }
    };

    try {
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          if (recentlyClosedSessions.has(sessionId)) {
            return c.json(
              { jsonrpc: '2.0', error: { code: -32600, message: 'Session expired, please reinitialize' }, id: null },
              400,
            );
          }
          if (sessions.size >= MAX_CONNECTIONS) {
            return c.json(
              { jsonrpc: '2.0', error: { code: -32600, message: 'Server at capacity' }, id: null },
              503,
            );
          }
          // Recovery path
          const server = createMcpServer();
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
          transport.onclose = () => {
            if (closingSessions.has(sessionId)) return;
            closingSessions.add(sessionId);
            sessions.delete(sessionId);
            const idleTimer = sessionIdleTimers.get(sessionId);
            if (idleTimer) { clearTimeout(idleTimer); sessionIdleTimers.delete(sessionId); }
            recentlyClosedSessions.add(sessionId);
            setTimeout(() => recentlyClosedSessions.delete(sessionId), 5000);
            void server.close().finally(() => closingSessions.delete(sessionId));
          };
          await server.connect(transport);
          // Force initialized state for recovery
          const webTransport = (transport as unknown as { _webStandardTransport: { _initialized: boolean; sessionId: string } })._webStandardTransport;
          if (webTransport && '_initialized' in webTransport) {
            webTransport._initialized = true;
            webTransport.sessionId = sessionId;
          }
          sessions.set(sessionId, { server, transport });
          touchSession(sessionId);
          await transport.handleRequest(req, res);
          sealResponse();
          return c.body(null);
        }

        // Session lifetime is NOT tied to SSE stream.
        touchSession(sessionId);
        await existing.transport.handleRequest(req, res);
        sealResponse();
        return c.body(null);
      }

      // New session
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { server, transport });
          touchSession(newSessionId);
        },
      });
      transport.onclose = () => {
        const closedId = transport.sessionId;
        if (closedId) {
          if (closingSessions.has(closedId)) return;
          closingSessions.add(closedId);
          sessions.delete(closedId);
          const idleTimer = sessionIdleTimers.get(closedId);
          if (idleTimer) { clearTimeout(idleTimer); sessionIdleTimers.delete(closedId); }
          recentlyClosedSessions.add(closedId);
          setTimeout(() => recentlyClosedSessions.delete(closedId), 5000);
          void server.close().finally(() => closingSessions.delete(closedId));
        }
      };
      await server.connect(transport);
      await transport.handleRequest(req, res);
      sealResponse();
      return c.body(null);
    } catch {
      sealResponse();
      if (res.headersSent) return c.body(null);
      return c.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }, 500);
    }
  });

  return { app, sessions };
}

// --- Helpers ---

async function startServer(): Promise<{ url: string; server: ReturnType<typeof serve>; sessions: Map<string, SessionContext> }> {
  const { app, sessions } = createTestServer();
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  // Wait for server to be listening
  await new Promise<void>((resolve) => {
    (server as unknown as http.Server).on('listening', resolve);
  });
  const addr = (server as unknown as http.Server).address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}/mcp`, server, sessions };
}

function stopServer(server: ReturnType<typeof serve>): Promise<void> {
  return new Promise((resolve) => {
    const httpServer = server as unknown as http.Server;
    httpServer.closeAllConnections();
    httpServer.close(() => resolve());
  });
}

async function createClient(url: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport);
  return { client, transport };
}

// --- Tests ---

void test('session: initialize creates a session with session ID', async () => {
  const { url, server } = await startServer();
  try {
    const { client, transport } = await createClient(url);
    assert.ok(transport.sessionId, 'should have a session ID after connect');
    await client.close();
  } finally {
    await stopServer(server);
  }
});

void test('session: SSE stream close does not terminate the session', async () => {
  const { url, server, sessions } = await startServer();
  try {
    // Initialize session via raw HTTP
    const initRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    const sessionId = initRes.headers.get('mcp-session-id')!;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    assert.ok(sessions.has(sessionId));

    // Open and immediately abort SSE stream
    const ctrl = new AbortController();
    const ssePromise = fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId },
      signal: ctrl.signal,
    });
    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    await ssePromise.catch(() => { /* abort expected */ });
    await new Promise((r) => setTimeout(r, 50));

    // Session must still exist
    assert.ok(sessions.has(sessionId), 'session should survive SSE stream close');
  } finally {
    await stopServer(server);
  }
});

void test('session: client can make requests after SSE reconnect', async () => {
  const { url, server } = await startServer();
  try {
    // Initialize session
    const initRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    assert.equal(initRes.status, 200);
    const sessionId = initRes.headers.get('mcp-session-id');
    assert.ok(sessionId);

    // Send initialized notification
    const notifRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.equal(notifRes.status, 202);

    // Open SSE stream (GET)
    const controller = new AbortController();
    const ssePromise = fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId },
      signal: controller.signal,
    });

    // Wait a bit then abort the SSE stream (simulates network drop)
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await ssePromise.catch(() => { /* abort expected */ });

    // Wait a bit — session should still be alive
    await new Promise((r) => setTimeout(r, 100));

    // Make another request on the same session — should succeed
    const listRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    });
    assert.equal(listRes.status, 200);
    const body = await listRes.text();
    assert.ok(body.includes('"id":2') || body.includes('"id": 2'), 'should get response for request id 2');
  } finally {
    await stopServer(server);
  }
});

void test('session: request without session ID creates new session', async () => {
  const { url, server } = await startServer();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('mcp-session-id'));
  } finally {
    await stopServer(server);
  }
});

void test('session: unknown session ID triggers recovery', async () => {
  const { url, server } = await startServer();
  try {
    // Send a request with a made-up session ID (simulates server restart)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': 'fake-session-id' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    // Should recover and handle the request (200) rather than reject
    assert.equal(res.status, 200);
  } finally {
    await stopServer(server);
  }
});

void test('session: recently-closed session is rejected', async () => {
  const { url, server, sessions } = await startServer();
  try {
    // Initialize a session
    const initRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    const sessionId = initRes.headers.get('mcp-session-id')!;

    // Close the session explicitly via transport
    const ctx = sessions.get(sessionId)!;
    await ctx.transport.close();
    await new Promise((r) => setTimeout(r, 50));

    // Now try to use the closed session — should be rejected
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error?: { message?: string } };
    assert.ok(body.error?.message?.includes('expired'));
  } finally {
    await stopServer(server);
  }
});

void test('session: multiple concurrent SSE streams are allowed', async () => {
  const { url, server } = await startServer();
  try {
    // Initialize
    const initRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    const sessionId = initRes.headers.get('mcp-session-id')!;

    // Send initialized
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // Open two SSE streams simultaneously
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    const sse1 = fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId }, signal: ctrl1.signal });
    const sse2 = fetch(url, { method: 'GET', headers: { Accept: 'text/event-stream', 'mcp-session-id': sessionId }, signal: ctrl2.signal });

    await new Promise((r) => setTimeout(r, 100));

    // Both should have connected (200)
    // Close both — session should survive
    ctrl1.abort();
    ctrl2.abort();
    await sse1.catch(() => { /* abort expected */ });
    await sse2.catch(() => { /* abort expected */ });

    await new Promise((r) => setTimeout(r, 100));

    // Session should still work
    const listRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 3 }),
    });
    assert.equal(listRes.status, 200);
  } finally {
    await stopServer(server);
  }
});

void test('session: POST without initialize is rejected', async () => {
  const { url, server } = await startServer();
  try {
    // Send a non-initialize request without session ID
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    // SDK should reject this (no session, not an initialize request)
    assert.ok([400, 500].includes(res.status), `expected 400 or 500, got ${res.status}`);
  } finally {
    await stopServer(server);
  }
});

void test('session: idle timeout closes session after inactivity', async () => {
  const { url, server, sessions } = await startServer();
  try {
    // Initialize
    const initRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    const sessionId = initRes.headers.get('mcp-session-id')!;
    assert.ok(sessions.has(sessionId));

    // Wait for idle timeout (test server uses 500ms)
    await new Promise((r) => setTimeout(r, 650));

    // Session should be gone
    assert.ok(!sessions.has(sessionId), 'session should be closed after idle timeout');
  } finally {
    await stopServer(server);
  }
});

void test('session: activity resets idle timeout', async () => {
  const { url, server, sessions } = await startServer();
  try {
    // Initialize
    const initRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: 1 }),
    });
    const sessionId = initRes.headers.get('mcp-session-id')!;

    // Send initialized notification
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // Wait 350ms (less than 500ms timeout), then make a request to reset timer
    await new Promise((r) => setTimeout(r, 350));
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    });

    // Wait another 350ms — total 700ms from init but only 350ms from last activity
    await new Promise((r) => setTimeout(r, 350));
    assert.ok(sessions.has(sessionId), 'session should still be alive after activity reset');

    // Wait for full timeout from last activity
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(!sessions.has(sessionId), 'session should be closed after idle timeout');
  } finally {
    await stopServer(server);
  }
});

void test('session: recovery is rejected when at max connections', async () => {
  const { url, server } = await startServer();
  try {
    // Fill up all session slots (maxConnections = 2 in test server)
    const sessionIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, id: i + 1 }),
      });
      sessionIds.push(res.headers.get('mcp-session-id')!);
    }

    // Try to recover with a fake session ID — should be rejected (at capacity)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': 'fake-overflow-id' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 99 }),
    });
    assert.equal(res.status, 503);
  } finally {
    await stopServer(server);
  }
});
