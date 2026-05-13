// Implements the search tool: delegates to a search backend and returns markdown.
import type { Page } from 'puppeteer';
import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ConnectionManager } from '../connection-manager.ts';
import { fenceExternalContent } from '../stages/content-fence.ts';
import type { SearchBackend, SearchResult } from '../search/interface.ts';
import { logger } from '../util/log.ts';

export async function runSearch(
  page: Page,
  query: string,
  backend: SearchBackend,
  sessionId?: string,
  pageNumber?: number,
): Promise<SearchResult> {
  const started = Date.now();
  logger.info({ backend: backend.name, queryLength: query.length, pageNumber }, 'Running search');
  const raw = await backend.search(page, query, sessionId, pageNumber);
  const result: SearchResult = { ...raw, backend: backend.name };

  logger.info(
    { backend: backend.name, durationMs: Date.now() - started, markdownLength: result.markdown.length },
    'Search completed',
  );

  return result;
}

export function register(server: McpServer, connectionManager: ConnectionManager, resolveBackend: () => SearchBackend): void {
  server.registerTool(
    'search',
    {
      description: 'Run web search and return page content as markdown.',
      inputSchema: z.object({
        query: z.string().min(1),
        page: z.number().int().positive().optional(),
      }),
    },
    async ({ query, page }, extra) => {
      const connectionId = extra.sessionId;
      if (!connectionId) {
        throw new Error('Session ID is required for search');
      }

      const started = Date.now();
      logger.info({ connectionId, queryLength: query.length, page }, 'Tool search invoked');
      const state = await connectionManager.getOrCreate(connectionId);
      if (!state.page) {
        throw new Error('Failed to create browser page');
      }

      const release = await state.mutex.acquire();
      try {
        const backend = resolveBackend();
        const result = await runSearch(state.page, query, backend, connectionId, page);
        result.markdown = fenceExternalContent(result.url, result.markdown);
        logger.info(
          { connectionId, durationMs: Date.now() - started, backend: result.backend, warnings: result.warnings.length },
          'Tool search completed',
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: { ...result },
        };
      } finally {
        release();
      }
    },
  );
}
