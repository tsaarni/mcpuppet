# Architecture

## Browser and sessions

The server launches a single Chrome instance on startup with an isolated profile (`.browser-data/` by default), separate from the user's own browser data. Agents do not have access to the user's cookies, history, or saved passwords. All agents share this one browser.

When an agent connects to `/mcp`, it gets an MCP session identified by a UUID. The first tool call in that session creates a new browser tab. That tab is reused for all subsequent calls in the same session. A mutex ensures only one tool call runs at a time per tab.

Sessions are cleaned up when the agent disconnects or after an idle timeout. Cleanup closes the tab and removes the session from the map. A max connections limit (default 10) caps how many sessions can exist at once.

If the server restarts while an agent still holds an old session ID, the server creates a fresh session but reuses the ID so the agent can continue without re-initializing.

## DevTools MCP

The `/devtools-mcp` endpoint embeds `chrome-devtools-mcp` as a second MCP service on the same HTTP server. It has its own sessions, independent from `/mcp`. Both share the same Chrome instance, so an agent can navigate a page via `/mcp` and inspect it via `/devtools-mcp`.

## Pipelines and stages

Every tool call (`fetch_url`, `search`) processes content through a pipeline - a list of stages executed in sequence.

Each stage is a class with one method: `execute(ctx)`. It receives a context object, does its work, and returns an updated context to the next stage. The context carries shared state: the current URL, HTML, parsed DOM, markdown output, the browser tab handle, and a warnings list.

Not every field exists from the start. For example, `html` is empty until NavigateStage loads the page, and `markdown` doesn't exist until ToMarkdownStage runs.

If a stage throws, the pipeline stops. Non-critical stages like cookie consent and readability catch their own errors and append warnings instead.

## Fetch pipeline

1. **UrlPolicy** - blocks private IPs, localhost, and cloud metadata endpoints. Resolves DNS to catch blocked addresses hiding behind hostnames.
2. **Navigate** - loads the page in the browser. Optionally intercepts every outgoing request to re-validate URLs against the same policy.
3. **RedirectGuard** - checks that redirects didn't exceed the limit and that the final URL still passes the SSRF policy. Catches cases where a public URL redirects to a blocked address.
4. **CookieConsent** - tries to dismiss cookie banners. Knows specific consent platforms and has a heuristic fallback.
5. **SanitizeAndClean** - strips scripts, styles, ads, hidden elements, navigation, and other boilerplate from the HTML.
6. **Readability** - extracts the main article content using Mozilla Readability. Falls back to full sanitized HTML if too much content would be lost.
7. **ToMarkdown** - converts HTML to Markdown.
8. **ContentFence** - wraps output in a tagged XML fence with a random nonce, marking it as untrusted. The nonce prevents page content from closing the fence with a predictable tag like `</external-content>` to escape and inject instructions. Defense against prompt injection from page content.

## Search pipelines

Search pipelines are shorter. The URL is hardcoded, so SSRF checks are not needed. Results are extracted directly from the DOM, so sanitization and readability are skipped.

Google:

1. **Navigate**
2. **GoogleCaptcha**
3. **CookieConsent**
4. **TypeSearchQuery**
5. **GoogleExtractResults**
6. **ToMarkdown**

DuckDuckGo:

1. **Navigate**
2. **CookieConsent**
3. **TypeSearchQuery**
4. **DuckDuckGoExtractResults**
5. **ToMarkdown**

## Debugging pipelines

Set `MCPUPPET_SESSION_DEBUG_DIR=./.session-debug` to enable debug dumps. The pipeline runner captures the HTML after every stage and writes a JSON file with the full final context. This helps identify which stage removed important content.
