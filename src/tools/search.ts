// Implements the search tool: delegates to a search backend and returns markdown.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Page } from "puppeteer";
import { z } from "zod";

import type { ConnectionManager } from "../connection-manager.ts";
import type { SearchBackend, SearchResult } from "../search/interface.ts";
import { fenceExternalContent } from "../stages/content-fence.ts";
import { logger } from "../util/log.ts";

export async function runSearch(
  page: Page,
  query: string,
  backend: SearchBackend,
  sessionId?: string,
): Promise<SearchResult> {
  const started = Date.now();
  logger.info({ backend: backend.name, queryLength: query.length }, "Running search");
  const raw = await backend.search(page, query, sessionId);
  const result: SearchResult = { ...raw, backend: backend.name };

  logger.info(
    { backend: backend.name, durationMs: Date.now() - started, markdownLength: result.markdown.length },
    "Search completed",
  );

  return result;
}

export function register(
  server: McpServer,
  connectionManager: ConnectionManager,
  resolveBackend: () => SearchBackend,
): void {
  server.registerTool(
    "search",
    {
      description: "Use this tool to fill gaps in your knowledge by searching the web for current, specific, or factual information that you cannot reliably answer from your training data alone.",
      inputSchema: z.object({
        query: z.string().min(1).describe(
          "Search query. Keep it short and simple, use plain keywords, avoid AND/OR or complex syntax. Do not include too many terms."
        ),
      }),
    },
    async ({ query }, extra) => {
      const connectionId = extra.sessionId;
      if (!connectionId) {
        throw new Error("Session ID is required for search");
      }

      const started = Date.now();
      logger.info({ connectionId, queryLength: query.length }, "Tool search invoked");
      const state = await connectionManager.getOrCreate(connectionId);
      if (!state.page) {
        throw new Error("Failed to create browser page");
      }

      const release = await state.mutex.acquire();
      try {
        const backend = resolveBackend();
        const result = await runSearch(state.page, query, backend, connectionId);
        state.lastSearchAt = Date.now();

        result.markdown = fenceExternalContent(result.url, result.markdown);
        logger.info(
          { connectionId, durationMs: Date.now() - started, backend: result.backend, warnings: result.warnings.length },
          "Tool search completed",
        );
        return {
          content: [{ type: "text", text: result.markdown }],
        };
      } finally {
        release();
      }
    },
  );
}
