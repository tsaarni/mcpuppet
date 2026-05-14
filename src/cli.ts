// CLI client for the mcpuppet MCP server. Provides `fetch` and `search` commands
// that connect to the server, execute a tool call, and close the session.
//
// Environment variables:
//
//   MCPUPPET_URL       - MCP server URL (default: http://127.0.0.1:5420/mcp)
//

const BASE_URL = process.env.MCPUPPET_URL ?? "http://127.0.0.1:5420/mcp";

async function mcpRequest(method: string, body: object, session?: string): Promise<{ text: string; sessionId?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (session) headers["Mcp-Session-Id"] = session;
  const resp = await fetch(BASE_URL, { method, headers, body: method === "DELETE" ? undefined : JSON.stringify(body) });
  return { text: await resp.text(), sessionId: resp.headers.get("mcp-session-id") ?? undefined };
}

async function initSession(): Promise<string> {
  const { sessionId } = await mcpRequest("POST", {
    jsonrpc: "2.0", method: "initialize", id: 1,
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcpuppet-cli", version: "0.1.0" } },
  });
  if (!sessionId) { process.stderr.write("Error: failed to get session from " + BASE_URL + "\n"); process.exit(1); }
  await mcpRequest("POST", { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId);
  return sessionId;
}

async function closeSession(session: string): Promise<void> {
  const headers: Record<string, string> = { "Mcp-Session-Id": session };
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  await fetch(BASE_URL, { method: "DELETE", headers }).catch(() => {});
}

interface McpContentItem {
  type: string;
  text: string;
}

interface McpResult {
  content?: McpContentItem[];
}

interface McpResponse {
  error?: { message: string };
  result?: McpResult;
}

async function callTool(session: string, tool: string, args: object): Promise<string> {
  const body = { jsonrpc: "2.0", method: "tools/call", id: 2, params: { name: tool, arguments: args } };
  const { text } = await mcpRequest("POST", body, session);

  // Response may be SSE (text/event-stream) or plain JSON; extract accordingly.
  let json = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) { json = line.slice(6); break; }
  }
  if (!json) json = text;

  const result = JSON.parse(json) as McpResponse;
  if (result.error) { process.stderr.write(result.error.message + "\n"); process.exit(1); }

  return (result.result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => {
      try { const d = JSON.parse(c.text) as { contentMarkdown?: string; markdown?: string; text?: string }; return d.contentMarkdown ?? d.markdown ?? c.text; } catch { return c.text; }
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

const session = await initSession();

try {
  if (cmd === "fetch") {
    let url = rest[0];
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
    process.stdout.write(await callTool(session, "fetch_url", { url }) + "\n");
  } else {
    process.stdout.write(await callTool(session, "search", { query: rest.join(" ") }) + "\n");
  }
} finally {
  await closeSession(session);
}
