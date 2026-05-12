// Implements the fetch_url tool: navigates to a URL with SSRF protection, extracts article content via
// Readability, converts it to paginated Markdown, and wraps it in an untrusted-content fence.
import type { HTTPRequest, HTTPResponse, Page } from 'puppeteer';
import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { config } from '../config.ts';
import { cleanHtmlStage } from '../stages/clean-html.ts';
import { fenceExternalContent } from '../stages/content-fence.ts';
import { cookieConsentStage } from '../stages/cookie-consent.ts';
import { readabilityStage } from '../stages/readability.ts';
import { redirectGuardStage } from '../stages/redirect-guard.ts';
import { sanitizeDomStage } from '../stages/sanitize-dom.ts';
import { toMarkdownStage } from '../stages/to-markdown.ts';
import { urlPolicyStage, validateUrlPolicy } from '../stages/url-policy.ts';
import { runPipeline } from '../pipeline.ts';
import type { ConnectionManager } from '../connection-manager.ts';
import type { Stage, StageContext } from '../types.ts';
import { logger } from '../util/log.ts';

export interface FetchUrlResult {
  url: string;
  title: string;
  contentMarkdown: string;
  warnings: string[];
}

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Returns true if URL policy must be enforced on this request (exported for unit tests). */
export const shouldEnforcePolicy = (isNavigation: boolean, url: string): boolean =>
  isNavigation || url.startsWith('http://') || url.startsWith('https://');

export const fetchUrl = async (page: Page, url: string, sessionId?: string): Promise<FetchUrlResult> => {
  const started = Date.now();
  logger.info({ url }, 'Fetching URL');
  const navigateStage: Stage = {
    name: 'navigate',
    async execute(ctx: StageContext): Promise<StageContext> {
      if (!ctx.url || !ctx.page) {
        throw new Error('URL and page are required for navigation');
      }

      let redirectCount = 0;
      const onResponse = (response: HTTPResponse) => {
        const status = response.status();
        if (status >= 300 && status < 400 && response.headers().location) {
          redirectCount += 1;
        }
      };

      // Intercept requests: enforce URL policy on navigation and all http/https sub-resources to prevent SSRF.
      const onRequest = (request: HTTPRequest) => {
        if (shouldEnforcePolicy(request.isNavigationRequest(), request.url())) {
          try {
            validateUrlPolicy(request.url());
            void request.continue();
          } catch {
            void request.abort('blockedbyclient');
          }
        } else {
          void request.continue();
        }
      };

      await page.setRequestInterception(true);
      page.on('request', onRequest);
      page.on('response', onResponse);
      try {
        await page.goto(ctx.url, {
          timeout: config.requestTimeoutMs,
          waitUntil: 'domcontentloaded',
        });
        await sleep(config.settleDelayMs);

        return {
          ...ctx,
          url: page.url(),
          html: await page.content(),
          title: await page.title(),
          redirectCount,
        };
      } finally {
        page.off('response', onResponse);
        page.off('request', onRequest);
        await page.setRequestInterception(false);
      }
    },
  };

  const pipeline: Stage[] = [
    urlPolicyStage,
    navigateStage,
    redirectGuardStage,
    cookieConsentStage,
    sanitizeDomStage,
    cleanHtmlStage,
    readabilityStage,
    toMarkdownStage,
    // contentFenceStage excluded: fencing is applied per page window below.
  ];

  const result = await runPipeline({ url, page, warnings: [], sessionId }, pipeline, {
    name: 'fetch-url',
    logContext: { url },
  });

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

      const result = await fetchUrl(state.page, url, connectionId);
      logger.info(
        { connectionId, durationMs: Date.now() - started, warnings: result.warnings.length },
        'Tool fetch_url completed',
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: asStructured(result),
      };
    },
  );
};
