// CLI client for the mcpuppet MCP server. Provides `fetch` and `search` commands
// that connect to the server and execute a tool call.
//
// Environment variables:
//
//   MCPUPPET_URL          - MCP server URL (default: http://127.0.0.1:5420/mcp)
//   MCPUPPET_SESSION_FILE - Path to session ID file (overrides default platform path)
//

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";

const BASE_URL = process.env.MCPUPPET_URL ?? "http://127.0.0.1:5420/mcp";

// Parse --session-file before command args.
const args = process.argv.slice(2);
let sessionFileOverride = process.env.MCPUPPET_SESSION_FILE;
while (args.length && args[0].startsWith("--session-file")) {
  const arg = args.shift()!;
  sessionFileOverride = arg.includes("=") ? arg.split("=").slice(1).join("=") : args.shift();
  break;
}

function sessionFilePath(): string {
  if (sessionFileOverride) return sessionFileOverride;
  const home = homedir();
  // macOS: ~/Library/Application Support/mcpuppet-cli/mcp-session-id
  // Linux: ~/.local/state/mcpuppet-cli/mcp-session-id (or $XDG_STATE_HOME/mcpuppet-cli/mcp-session-id)
  const dir = platform() === "darwin"
    ? join(home, "Library", "Application Support", "mcpuppet-cli")
    : join(process.env.XDG_STATE_HOME ?? join(home, ".local", "state"), "mcpuppet-cli");
  mkdirSync(dir, { recursive: true });
  return join(dir, "mcp-session-id");
}

function loadSessionId(): string | undefined {
  const p = sessionFilePath();
  if (existsSync(p)) return readFileSync(p, "utf-8").trim() || undefined;
  return undefined;
}

function saveSessionId(id: string): void {
  const p = sessionFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, id + "\n");
}

function clearSessionId(): void {
  try { unlinkSync(sessionFilePath()); } catch { /* ignore */ }
}

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

const [cmd, ...rest] = args;

if (!cmd || !["fetch", "search"].includes(cmd)) {
  process.stderr.write("Usage: mcpuppet-cli fetch <url>\n       mcpuppet-cli search <query>\n");
  process.exit(1);
}

if (!rest.length) {
  process.stderr.write(`Usage: mcpuppet-cli ${cmd} <${cmd === "fetch" ? "url" : "query"}>\n`);
  process.exit(1);
}

let session = loadSessionId();

async function ensureSession(): Promise<string> {
  if (session) {
    // Validate existing session with a lightweight call.
    try {
      await callTool(session, "fetch_url", { url: "about:blank" });
      return session;
    } catch {
      clearSessionId();
    }
  }
  const id = await initSession();
  saveSessionId(id);
  return id;
}

session = await ensureSession();

if (cmd === "fetch") {
  let url = rest[0];
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
  process.stdout.write(await callTool(session, "fetch_url", { url }) + "\n");
} else {
  process.stdout.write(await callTool(session, "search", { query: rest.join(" ") }) + "\n");
}
