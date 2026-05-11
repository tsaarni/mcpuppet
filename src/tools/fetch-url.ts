// Implements the fetch_url tool: navigates to a URL with SSRF protection, extracts article content via
// Readability, converts it to paginated Markdown, and wraps it in an untrusted-content fence.
import type { HTTPRequest, HTTPResponse, Page } from 'puppeteer';

import { config } from '../config.ts';
import { cleanHtmlFilter } from '../filters/clean-html.ts';
import { fenceExternalContent } from '../filters/content-fence.ts';
import { googleConsentFilter } from '../filters/google-consent.ts';
import { readabilityFilter } from '../filters/readability.ts';
import { redirectGuardFilter } from '../filters/redirect-guard.ts';
import { sanitizeDomFilter } from '../filters/sanitize-dom.ts';
import { toMarkdownFilter } from '../filters/to-markdown.ts';
import { urlPolicyFilter, validateUrlPolicy } from '../filters/url-policy.ts';
import { runPipeline } from '../pipeline.ts';
import type { Filter, FilterContext } from '../types.ts';
import { logger } from '../util/log.ts';

export interface FetchUrlResult {
  url: string;
  title: string;
  contentMarkdown: string;
  hasMore: boolean;
  scrollPosition: number;
  warnings: string[];
}

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Returns true if URL policy must be enforced on this request (exported for unit tests). */
export const shouldEnforcePolicy = (isNavigation: boolean, url: string): boolean =>
  isNavigation || url.startsWith('http://') || url.startsWith('https://');

// Characters of extracted markdown to return per call. Keyed by scroll (char offset).
const CONTENT_PAGE_CHARS = 4000;

export const fetchUrl = async (page: Page, url: string, scroll = 0): Promise<FetchUrlResult> => {
  const started = Date.now();
  logger.info({ url, scroll }, 'Fetching URL');
  const navigateFilter: Filter = {
    name: 'navigate',
    async execute(ctx: FilterContext): Promise<FilterContext> {
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

  const pipeline: Filter[] = [
    urlPolicyFilter,
    navigateFilter,
    redirectGuardFilter,
    googleConsentFilter,
    sanitizeDomFilter,
    cleanHtmlFilter,
    readabilityFilter,
    toMarkdownFilter,
    // contentFenceFilter excluded: fencing is applied per page window below.
  ];

  const result = await runPipeline({ url, page, warnings: [] }, pipeline, {
    name: 'fetch-url',
    logContext: { url },
  });

  // Paginate extracted markdown by character window keyed by scroll (char offset).
  // This keeps hasMore/scrollPosition coherent with actual returned content,
  // independent of DOM scroll state (Readability extracts the whole article anyway).
  const fullMarkdown = result.markdown ?? '';
  const pageStart = Number.isFinite(scroll) && scroll > 0 ? scroll : 0;
  const pageEnd = pageStart + CONTENT_PAGE_CHARS;
  const pageContent = fullMarkdown.slice(pageStart, pageEnd);
  const hasMore = pageEnd < fullMarkdown.length;
  const scrollPosition = pageStart + pageContent.length;

  const response = {
    url: result.url ?? url,
    title: result.title ?? '',
    contentMarkdown: fenceExternalContent(result.url ?? url, pageContent),
    hasMore,
    scrollPosition,
    warnings: result.warnings,
  };

  logger.info(
    {
      url: response.url,
      durationMs: Date.now() - started,
      markdownLength: fullMarkdown.length,
      returnedLength: pageContent.length,
      hasMore,
      warnings: response.warnings.length,
    },
    'Fetch URL completed',
  );
  return response;
};
