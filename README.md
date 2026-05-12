# McPuppet

An MCP server that gives AI agents a local browser. It launches a Chrome/Chromium instance via Puppeteer and exposes tools to agents so they can navigate web pages and run searches.
The browser runs in non-headless mode by default so you can see what the agents are doing.

Each MCP session gets a dedicated browser tab. The tab is created on first use and closed automatically when the session ends. Multiple agents can connect simultaneously, each with their own tab.

Content is cleaned before being returned: hidden elements and HTML comments are stripped, boilerplate is removed, Mozilla Readability extracts the main article, and the result is converted to Markdown for more effective token usage. The output is wrapped in a tagged fence so agents know it's untrusted external content.

On startup, the browser visits google.com to establish cookies and dismiss consent dialogs, reducing the chance of CAPTCHAs on the first actual search.

## Tools

- `fetch_url`: Navigate to a URL and return the full extracted Markdown content.
- `search`: Run a web search and return the results page as Markdown. Accepts an optional `page` parameter (1-indexed) for navigating through result pages.

## Running

```bash
npm install
npm run build
node dist/src/main.js
```

The server starts on `http://127.0.0.1:3000` by default. All settings are controlled by environment variables (copy `.env.example` to `.env` to customize):

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `3000` | HTTP port |
| `HEADLESS` | `false` | Run browser headless (set `true` for CI) |
| `SLOW_MO` | `0` | ms delay per Puppeteer action (for human observation) |
| `MAX_CONNECTIONS` | `10` | Max concurrent sessions |
| `SEARCH_BACKEND` | `google` | Search provider |
| `LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `USER_DATA_DIR` | `./.browser-data` | Chromium profile (persists cookies across restarts) |
| `SESSION_DEBUG_DIR` | _(empty)_ | Directory for session debug dumps (disabled when empty) |

Development mode with hot reload:

```bash
npm run dev
```

## Adding to Kiro as a remote MCP server

Edit `~/.kiro/settings/mcp.json` (user-wide) or `.kiro/settings/mcp.json` (workspace):

```json
{
  "mcpServers": {
    "mcpuppet": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```
