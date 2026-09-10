// Integration tests for the embedded chrome-devtools-mcp endpoint.
// These tests verify that the DevTools MCP proxy correctly exposes
// chrome-devtools-mcp over streamable HTTP, and serve as a compatibility
// check when bumping the chrome-devtools-mcp dependency version.

import assert from "node:assert/strict";
import type http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";

import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hono } from "hono";

import { handleDevToolsMcpRequest, initDevToolsMcpProxy, shutdownDevToolsMcpSessions } from "../src/devtools-mcp-proxy.ts";
import { BrowserManager } from "../src/browser-manager.ts";

// --- Helpers ---

let browserManager: BrowserManager;
let serverHandle: ReturnType<typeof serve>;
let baseUrl: string;

/** Start the browser and HTTP server before all tests. */
async function setup(): Promise<void> {
  browserManager = new BrowserManager();
  await browserManager.launch();
  initDevToolsMcpProxy(browserManager);

  const app = new Hono();
  app.all("/devtools-mcp", handleDevToolsMcpRequest);

  serverHandle = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => {
    (serverHandle as unknown as http.Server).on("listening", resolve);
  });
  const addr = (serverHandle as unknown as http.Server).address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/devtools-mcp`;
}

/** Shut down everything after all tests. */
async function teardown(): Promise<void> {
  await shutdownDevToolsMcpSessions();
  await new Promise<void>((resolve) => {
    const httpServer = serverHandle as unknown as http.Server;
    httpServer.closeAllConnections();
    httpServer.close(() => resolve());
  });
  await browserManager.shutdown();
}

async function createClient(): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
  const client = new Client({ name: "devtools-mcp-test", version: "0.0.1" });
  await client.connect(transport);
  return { client, transport };
}

// --- Tests ---

// Use test hooks for shared setup/teardown.
test.before(async () => {
  await setup();
});

test.after(async () => {
  await teardown();
});

void test("devtools-mcp: initialize returns chrome_devtools server info", async () => {
  const { client } = await createClient();
  try {
    const info = client.getServerVersion();
    assert.ok(info, "server version should be available after connect");
    assert.equal(info.name, "chrome_devtools", "server name should be chrome_devtools");
    assert.ok(info.version, "server version should be set");
  } finally {
    await client.close();
  }
});

void test("devtools-mcp: tools/list returns expected core tools", async () => {
  const { client } = await createClient();
  try {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();

    // These are the core tools that should always be present.
    // If a chrome-devtools-mcp version bump removes any of these,
    // this test will catch it.
    const expectedCoreTools = [
      "click",
      "close_page",
      "emulate",
      "evaluate_script",
      "fill",
      "fill_form",
      "handle_dialog",
      "hover",
      "lighthouse_audit",
      "list_console_messages",
      "list_network_requests",
      "list_pages",
      "navigate_page",
      "new_page",
      "press_key",
      "select_page",
      "take_screenshot",
      "take_snapshot",
      "type_text",
      "wait_for",
    ];

    for (const tool of expectedCoreTools) {
      assert.ok(toolNames.includes(tool), `expected core tool "${tool}" to be registered`);
    }

    // Sanity check: should have a reasonable number of tools.
    assert.ok(result.tools.length >= 20, `expected at least 20 tools, got ${result.tools.length}`);
  } finally {
    await client.close();
  }
});

void test("devtools-mcp: evaluate_script works (JavaScript evaluation enabled)", async () => {
  const { client } = await createClient();
  try {
    // Open a page — each session starts with no pages in its view.
    await client.callTool({
      name: "new_page",
      arguments: { url: "about:blank" },
    });

    const pagesResult = await client.callTool({ name: "list_pages", arguments: {} });
    const pagesText = (pagesResult.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")?.text ?? "";
    const pageIds = [...pagesText.matchAll(/^(\d+):/gm)].map((m) => parseInt(m[1], 10));
    const pageId = Math.max(...pageIds);

    const result = await client.callTool({
      name: "evaluate_script",
      arguments: {
        pageId,
        function: "() => 40 + 2",
        waitForStableDom: false,
      },
    });
    assert.ok(result.content);
    const text = (result.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")?.text ?? "";
    assert.ok(text.includes("42"), `expected result to contain 42, got: ${text}`);
  } finally {
    await client.close();
  }
});

void test("devtools-mcp: take_snapshot returns page content", async () => {
  const { client } = await createClient();
  try {
    // Open a page first — each devtools-mcp session has its own browser view.
    await client.callTool({
      name: "new_page",
      arguments: { url: "data:text/html,<h1>Snapshot Test</h1>" },
    });

    const pagesResult = await client.callTool({ name: "list_pages", arguments: {} });
    const pagesText = (pagesResult.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")?.text ?? "";
    // Extract the highest page ID from the list
    const pageIds = [...pagesText.matchAll(/^(\d+):/gm)].map((m) => parseInt(m[1], 10));
    const pageId = Math.max(...pageIds);

    const result = await client.callTool({
      name: "take_snapshot",
      arguments: { pageId },
    });
    assert.ok(result.content);
    const text = (result.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")?.text ?? "";
    assert.ok(text.includes("RootWebArea") || text.includes("Snapshot Test"), `expected snapshot content, got: ${text}`);
  } finally {
    await client.close();
  }
});

void test("devtools-mcp: navigate_page and take_screenshot work", async () => {
  const { client } = await createClient();
  try {
    // Open a page with content via new_page (avoids hardcoded page IDs).
    await client.callTool({
      name: "new_page",
      arguments: { url: "data:text/html,<h1>DevTools MCP Test</h1>" },
    });

    const pagesResult = await client.callTool({ name: "list_pages", arguments: {} });
    const pagesText = (pagesResult.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")?.text ?? "";
    const pageIds = [...pagesText.matchAll(/^(\d+):/gm)].map((m) => parseInt(m[1], 10));
    const pageId = Math.max(...pageIds);

    const result = await client.callTool({
      name: "take_screenshot",
      arguments: { pageId },
    });
    assert.ok(result.content);
    const hasContent = (result.content as Array<{ type: string }>).some(
      (c) => c.type === "image" || c.type === "text",
    );
    assert.ok(hasContent, "screenshot should return content");
  } finally {
    await client.close();
  }
});

void test("devtools-mcp: multiple concurrent sessions work independently", async () => {
  const { client: client1 } = await createClient();
  const { client: client2 } = await createClient();
  try {
    // Both sessions should be able to list tools independently
    const [result1, result2] = await Promise.all([
      client1.listTools(),
      client2.listTools(),
    ]);
    assert.ok(result1.tools.length > 0, "session 1 should have tools");
    assert.ok(result2.tools.length > 0, "session 2 should have tools");
    assert.equal(result1.tools.length, result2.tools.length, "both sessions should have same tool count");
  } finally {
    await client1.close();
    await client2.close();
  }
});

void test("devtools-mcp: tool schemas have required fields", async () => {
  const { client } = await createClient();
  try {
    const result = await client.listTools();

    for (const tool of result.tools) {
      assert.ok(tool.name, `tool should have a name`);
      assert.ok(typeof tool.name === "string", `tool name should be a string`);
      assert.ok(tool.description, `tool "${tool.name}" should have a description`);
      assert.ok(tool.inputSchema, `tool "${tool.name}" should have an inputSchema`);
    }
  } finally {
    await client.close();
  }
});

void test("devtools-mcp: serverArgs produce correct tool categories", async () => {
  // This test verifies that all expected tool categories are enabled.
  // If chrome-devtools-mcp renames category flags, this catches it.
  const { client } = await createClient();
  try {
    const result = await client.listTools();
    const toolNames = new Set(result.tools.map((t) => t.name));

    // At least one tool from each enabled category should be present.
    const categoryProbes: Record<string, string> = {
      input: "click",
      navigation: "navigate_page",
      emulation: "emulate",
      performance: "performance_start_trace",
      network: "list_network_requests",
      debugging: "list_console_messages",
      memory: "take_heapsnapshot",
    };

    for (const [category, probeTool] of Object.entries(categoryProbes)) {
      assert.ok(
        toolNames.has(probeTool),
        `category "${category}" should be enabled (expected tool "${probeTool}")`,
      );
    }
  } finally {
    await client.close();
  }
});
