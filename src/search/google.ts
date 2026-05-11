// Google search backend: navigates to google.com and extracts search results via multiple CSS selector strategies.
// Pre-extraction concerns (CAPTCHA, cookie consent) are handled as reusable filters in src/filters/.
import type { Page } from 'puppeteer';

import { config } from '../config.ts';
import { googleCaptchaFilter } from '../filters/google-captcha.ts';
import { googleConsentFilter } from '../filters/google-consent.ts';
import { runPipeline } from '../pipeline.ts';
import type { Filter, FilterContext } from '../types.ts';
import type { SearchBackend, SearchBackendResult, SearchResult } from './interface.ts';
import { logger } from '../util/log.ts';

const SELECTOR_SETS = [
  {
    container: 'div.g',
    title: 'h3',
    snippet: 'div[data-sncf], div.VwiC3b',
    link: 'a[href]',
  },
  {
    container: '[data-hveid] > div',
    title: 'h3',
    snippet: 'span:not([class])',
    link: 'a[href^="http"]',
  },
  {
    container: 'div[data-ved]',
    title: 'h3',
    snippet: 'div > span',
    link: 'a[href^="http"]:has(h3)',
  },
] as const;

const extractResults = async (
  page: Page,
  selectorSet: (typeof SELECTOR_SETS)[number],
  limit: number,
): Promise<SearchResult[]> =>
  page.evaluate(
    ({ selectors, max }) => {
      const entries = Array.from(document.querySelectorAll(selectors.container));
      const results: SearchResult[] = [];

      for (const entry of entries) {
        if (results.length >= max) {
          break;
        }

        const titleNode = entry.querySelector(selectors.title);
        const linkNode = entry.querySelector(selectors.link) as HTMLAnchorElement | null;
        const snippetNode = entry.querySelector(selectors.snippet);

        const title = titleNode?.textContent?.trim() ?? '';
        const url = linkNode?.href?.trim() ?? '';
        const snippet = snippetNode?.textContent?.trim() ?? '';

        if (!title || !url) {
          continue;
        }

        results.push({ title, snippet, url });
      }

      return results;
    },
    { selectors: selectorSet, max: limit },
  );

const navigateFilter: Filter = {
  name: 'navigate',
  async execute(ctx: FilterContext): Promise<FilterContext> {
    if (!ctx.page || !ctx.url) {
      throw new Error('URL and page are required for navigation');
    }
    await ctx.page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });
    return ctx;
  },
};

export class GoogleSearchBackend implements SearchBackend {
  readonly name = 'google';

  async search(page: Page, query: string, limit: number): Promise<Omit<SearchBackendResult, 'backend'>> {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const started = Date.now();

    const preExtract = await runPipeline(
      { url, page, warnings: [] },
      [navigateFilter, googleCaptchaFilter, googleConsentFilter],
      { name: 'google-search-pre-extract', logContext: { backend: this.name, queryLength: query.length, limit } },
    );

    for (const [index, selectorSet] of SELECTOR_SETS.entries()) {
      const results = await extractResults(page, selectorSet, limit);
      logger.debug({ backend: this.name, selectorSet: index + 1, extracted: results.length }, 'Search selector pass complete');
      if (results.length > 0) {
        logger.debug({ backend: this.name, durationMs: Date.now() - started, extracted: results.length }, 'Search provider extraction succeeded');
        return { results, warnings: preExtract.warnings };
      }
    }

    logger.warn({ backend: this.name, durationMs: Date.now() - started }, 'Search provider extraction returned no matches');
    return {
      results: [],
      warnings: [...preExtract.warnings, 'Google result selectors did not match the page structure.'],
    };
  }
}
