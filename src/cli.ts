#!/usr/bin/env node
//
// CLI client for the mcpuppet MCP server. Provides `fetch` and `search` commands
// that connect to the server and operate a shared browser tab per session.
//
// Options:
//
//   --session-id <id>  - Explicit session identifier (highest priority)
//
// Environment variables:
//
//   MCPUPPET_URL       - MCP server URL (default: http://127.0.0.1:3000/mcp)
//   KIRO_SESSION_ID    - Session identifier for isolating browser tabs per agent session.
//                        Set by the user or automatically by Kiro when invoked from an agent.
//                        Overridden by --session-id if provided. Falls back to "default"
//                        when neither is set.
//
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE_URL = process.env["MCPUPPET_URL"] || "http://127.0.0.1:3000/mcp";

// Session ID precedence: --session-id flag > KIRO_SESSION_ID env > "default"
let SESSION_ID = process.env["KIRO_SESSION_ID"] || "default";
const sidIdx = process.argv.indexOf("--session-id");
if (sidIdx !== -1 && process.argv[sidIdx + 1]) {
  SESSION_ID = process.argv[sidIdx + 1];
  process.argv.splice(sidIdx, 2);
}

async function mcpRequest(body: object, session?: string): Promise<{ text: string; sessionId?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (session) headers["Mcp-Session-Id"] = session;
  const resp = await fetch(BASE_URL, { method: "POST", headers, body: JSON.stringify(body) });
  return { text: await resp.text(), sessionId: resp.headers.get("mcp-session-id") || undefined };
}

async function getSession(): Promise<string> {
  const { sessionId } = await mcpRequest({
    jsonrpc: "2.0", method: "initialize", id: 1,
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcpuppet-cli", version: "0.1.0" } },
  });

  if (!sessionId) { process.stderr.write("Error: failed to get session from " + BASE_URL + "\n"); process.exit(1); }
  await mcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
  return sessionId;
}

async function callTool(session: string, tool: string, args: object): Promise<string> {
  const body = { jsonrpc: "2.0", method: "tools/call", id: 2, params: { name: tool, arguments: args } };
  const { text } = await mcpRequest(body, session);

  // Response may be SSE (text/event-stream) or plain JSON; extract accordingly.
  let json = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) { json = line.slice(6); break; }
  }
  if (!json) json = text;

  const result = JSON.parse(json);
  if (result.error) { process.stderr.write(result.error.message + "\n"); process.exit(1); }

  return (result.result?.content || [])
    .filter((c: any) => c.type === "text")
    .map((c: any) => {
      try { const d = JSON.parse(c.text); return d.contentMarkdown || d.markdown || c.text; } catch { return c.text; }
    })
    .join("\n");
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || !["fetch", "search"].includes(cmd)) {
  process.stderr.write("Usage: mcpuppet-cli fetch <url>\n       mcpuppet-cli search <query>\n");
  process.exit(1);
}

if (!rest.length) {
  process.stderr.write(`Usage: mcpuppet-cli ${cmd} <${cmd === "fetch" ? "url" : "query"}>\n`);
  process.exit(1);
}

const session = await getSession();

if (cmd === "fetch") {
  let url = rest[0];
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
  process.stdout.write(await callTool(session, "fetch_url", { url }) + "\n");
} else {
  process.stdout.write(await callTool(session, "search", { query: rest.join(" ") }) + "\n");
}
