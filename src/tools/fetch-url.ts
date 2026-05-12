// Implements the fetch_url tool: navigates to a URL with SSRF protection, extracts article content via
// Readability, converts it to paginated Markdown, and wraps it in an untrusted-content fence.
import type { Page } from 'puppeteer';
import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { config } from '../config.ts';
import { sanitizeAndCleanStage } from '../stages/sanitize-and-clean.ts';
import { fenceExternalContent } from '../stages/content-fence.ts';
import { cookieConsentStage } from '../stages/cookie-consent.ts';
import { createNavigateStage } from '../stages/navigate.ts';
import { readabilityStage } from '../stages/readability.ts';
import { redirectGuardStage } from '../stages/redirect-guard.ts';
import { toMarkdownStage } from '../stages/to-markdown.ts';
import { urlPolicyStage } from '../stages/url-policy.ts';
import { runPipeline } from '../pipeline.ts';
import type { ConnectionManager } from '../connection-manager.ts';
import type { Stage } from '../types.ts';
import { logger } from '../util/log.ts';

export interface FetchUrlResult {
  url: string;
  title: string;
  contentMarkdown: string;
  warnings: string[];
}

export const fetchUrl = async (page: Page, url: string, sessionId?: string): Promise<FetchUrlResult> => {
  const started = Date.now();
  logger.info({ url }, 'Fetching URL');

  const pipeline: Stage[] = [
    urlPolicyStage,
    createNavigateStage({ ssrf: true, settleDelayMs: config.settleDelayMs }),
    redirectGuardStage,
    cookieConsentStage,
    sanitizeAndCleanStage,
    readabilityStage,
    toMarkdownStage,
    // contentFenceStage excluded: fencing is applied per page window below.
  ];

  const result = await runPipeline({ url, page, warnings: [], sessionId }, pipeline, {
    name: 'fetch-url',
    logContext: { url },
  });

  try {
    const markdown = result.markdown ?? '';

    const response = {
      url: result.url ?? url,
      title: result.title ?? '',
      contentMarkdown: fenceExternalContent(result.url ?? url, markdown),
      warnings: result.warnings,
    };

    logger.info(
      {
        url: response.url,
        durationMs: Date.now() - started,
        markdownLength: markdown.length,
        warnings: response.warnings.length,
      },
      'Fetch URL completed',
    );
    return response;
  } finally {
    if (result.cleanups) {
      for (const cleanup of result.cleanups) {
        await cleanup();
      }
    }
  }
};

const asStructured = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

export const register = (server: McpServer, connectionManager: ConnectionManager): void => {
  server.registerTool(
    'fetch_url',
    {
      description: 'Navigate to URL and return extracted markdown content.',
      inputSchema: z.object({
        url: z.string().url(),
      }),
    },
    async ({ url }, extra) => {
      const connectionId = extra.sessionId;
      if (!connectionId) {
        throw new Error('Session ID is required for fetch_url');
      }

      const started = Date.now();
      logger.info({ connectionId, url }, 'Tool fetch_url invoked');
      const state = await connectionManager.getOrCreate(connectionId);
      if (!state.page) {
        throw new Error('Failed to create browser page');
      }

      const release = await state.mutex.acquire();
      try {
        const result = await fetchUrl(state.page, url, connectionId);
        logger.info(
          { connectionId, durationMs: Date.now() - started, warnings: result.warnings.length },
          'Tool fetch_url completed',
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: asStructured(result),
        };
      } finally {
        release();
      }
    },
  );
};
