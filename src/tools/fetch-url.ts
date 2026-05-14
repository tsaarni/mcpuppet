// Implements the fetch_url tool: navigates to a URL with SSRF protection, extracts article content via
// Readability, converts it to Markdown, and wraps it in an untrusted-content fence.
import type { Page } from 'puppeteer';
import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { config } from '../config.ts';
import { SanitizeAndCleanStage } from '../stages/sanitize-and-clean.ts';
import { ContentFenceStage } from '../stages/content-fence.ts';
import { CookieConsentStage } from '../stages/cookie-consent.ts';
import { NavigateStage } from '../stages/navigate.ts';
import { ReadabilityStage } from '../stages/readability.ts';
import { RedirectGuardStage } from '../stages/redirect-guard.ts';
import { ToMarkdownStage } from '../stages/to-markdown.ts';
import { UrlPolicyStage } from '../stages/url-policy.ts';
import { runPipeline } from '../pipeline.ts';
import type { ConnectionManager } from '../connection-manager.ts';
import { Stage } from '../types.ts';
import { logger } from '../util/log.ts';

export interface FetchUrlResult {
  contentMarkdown: string;
  warnings: string[];
}

export async function fetchUrl(page: Page, url: string, sessionId?: string): Promise<FetchUrlResult> {
  const started = Date.now();
  logger.info({ url }, 'Fetching URL');

  const pipeline: Stage[] = [
    new UrlPolicyStage(),
    new NavigateStage({ ssrf: true, settleDelayMs: config.settleDelayMs }),
    new RedirectGuardStage(),
    new CookieConsentStage(),
    new SanitizeAndCleanStage(),
    new ReadabilityStage(),
    new ToMarkdownStage(),
    new ContentFenceStage(),
  ];

  const result = await runPipeline({ url, page, warnings: [], sessionId }, pipeline, {
    name: 'fetch-url',
    logContext: { url },
  });

  const markdown = result.markdown ?? '';

  const response = {
    contentMarkdown: markdown,
    warnings: result.warnings,
  };

  logger.info(
    {
      url: result.url ?? url,
      durationMs: Date.now() - started,
      markdownLength: markdown.length,
      warnings: response.warnings.length,
    },
    'Fetch URL completed',
  );

  // Run cleanups (remove event listeners etc.)
  if (result.cleanups) {
    for (const cleanup of result.cleanups) {
      cleanup();
    }
  }

  return response;
}

export function register(server: McpServer, connectionManager: ConnectionManager): void {
  server.registerTool(
    'fetch_url',
    {
      description: 'Navigate to URL and return extracted markdown content.',
      inputSchema: z.object({
        url: z.url(),
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
          content: [{ type: 'text', text: result.contentMarkdown }],
        };
      } finally {
        release();
      }
    },
  );
}
