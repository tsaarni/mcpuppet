# McPuppet

> [!NOTE]
> This codebase is LLM-generated.

An MCP server that gives AI agents a local browser. It launches a Chrome/Chromium instance via Puppeteer and exposes tools to agents so they can navigate web pages and run searches.
The browser runs in non-headless mode by default so you can see what the agents are doing.

Each MCP session gets a dedicated browser tab. The tab is created on first use and closed automatically when the session ends. Multiple agents can connect simultaneously, each with their own tab.

Content is cleaned before being returned: hidden elements and HTML comments are stripped, boilerplate is removed, Mozilla Readability extracts the main article, and the result is converted to Markdown for more effective token usage. The output is wrapped in a tagged fence so agents know it's untrusted external content.

## Tools

- `fetch_url`: Navigate to a URL and return the full extracted Markdown content.
- `search`: Run a web search and return the results page as Markdown. Accepts an optional `page` parameter (1-indexed) for navigating through result pages.

## Quick start

```bash
npm install  # to install dependencies
npm start [-- --env-file=<config-file>]
```

The server starts on `http://127.0.0.1:5420` by default.

## Configuration

All settings are controlled by environment variables:

| Variable | Default | Description |
|---|---|---|
| `MCPUPPET_HOST` | `127.0.0.1` | Bind address |
| `MCPUPPET_PORT` | `5420` | HTTP port |
| `MCPUPPET_HEADLESS` | `false` | Run browser headless |
| `MCPUPPET_SLOW_MO` | `0` | ms delay per Puppeteer action (for human observation) |
| `MCPUPPET_MAX_CONNECTIONS` | `10` | Max concurrent sessions |
| `MCPUPPET_REQUEST_TIMEOUT_MS` | `30000` | Page request timeout (msec) |
| `MCPUPPET_SETTLE_DELAY_MS` | `1000` | Maximum wait after page load for network to settle before extracting content (msec) |
| `MCPUPPET_MAX_REDIRECTS` | `5` | Maximum number of HTTP redirects to follow |
| `MCPUPPET_SEARCH_BACKEND` | `google` | Search provider (only `google` is supported) |
| `MCPUPPET_LOG_LEVEL` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `MCPUPPET_EXECUTABLE_PATH` | _(empty)_ | Path to Chrome/Chromium executable (uses Puppeteer's bundled version if empty) |
| `MCPUPPET_USER_DATA_DIR` | `./.browser-data` | Chrome/Chromium profile (persists cookies across restarts) |
| `MCPUPPET_SESSION_DEBUG_DIR` | _(empty)_ | Directory for session debug dumps (disabled when empty) |
| `MCPUPPET_AUTH_TOKEN` | _(empty)_ | Bearer token required on all requests (unauthenticated if unset) |

You can use environment variables directly or load them from an environment file.
Refer to [`.env.example`](.env.example) as a template.

> [!WARNING]
> When `MCPUPPET_AUTH_TOKEN` is not set the server accepts all requests without authentication. It is intended for localhost use only (`MCPUPPET_HOST=127.0.0.1`). Do not expose it on a network interface without setting a token.

> [!NOTE]
> **Ubuntu 23.10+:** Puppeteer's bundled Chrome fails with `No usable sandbox!` due to [AppArmor user namespace restrictions](https://github.com/puppeteer/puppeteer/issues/12818). Fix: set `MCPUPPET_EXECUTABLE_PATH=/opt/google/chrome/chrome` to use system Chrome.


## Adding to Kiro as a remote MCP server

Edit `~/.kiro/agents/<agent>.json` (agent-specific) or `~/.kiro/settings/mcp.json` (user-wide) or `.kiro/settings/mcp.json` (workspace):

```json
{
  "mcpServers": {
    "mcpuppet": {
      "url": "http://127.0.0.1:5420/mcp"
    }
  }
}
```

## Using via agent skills (without MCP)

For environments without MCP support, agents can invoke mcpuppet via the CLI client [`src/cli.ts`](src/cli.ts).
It acts as an MCP client that connects to the local server.

Build the standalone CLI binary and copy it to your PATH:

```bash
npm run build-cli
cp -p dist/mcpuppet-cli /usr/local/bin/
```

`dist/cli.mjs` is a self-contained file with no external dependencies — only Node.js is required to run it.

Then use a skill file to guide the agent to call the CLI:

```markdown
---
name: mcpuppet
description: Fetch web pages and run web searches via a local browser. Use when you need to read documentation or search the internet.
---

Use following commands to interact with the browser:

- `mcpuppet-cli fetch <url>` — Fetch a web page
- `mcpuppet-cli search <query>` — Run a web search
```

## Contributing

Please refer to [CONTRIBUTING.md](CONTRIBUTING.md).
