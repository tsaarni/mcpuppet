// Google search backend: navigates directly to search results URL
// and converts the results page to markdown via a stage pipeline.
import type { Page } from 'puppeteer';

import { cleanHtmlStage } from '../stages/clean-html.ts';
import { googleCaptchaStage } from '../stages/google-captcha.ts';
import { cookieConsentStage } from '../stages/cookie-consent.ts';
import { readabilityStage } from '../stages/readability.ts';
import { sanitizeDomStage } from '../stages/sanitize-dom.ts';
import { toMarkdownStage } from '../stages/to-markdown.ts';
import { runPipeline } from '../pipeline.ts';
import { config } from '../config.ts';
import type { Stage, StageContext } from '../types.ts';
import type { SearchBackend, SearchResult } from './interface.ts';

/** Navigate directly to the Google search results URL. */
const directSearchStage: Stage = {
  name: 'navigate',
  async execute(ctx: StageContext): Promise<StageContext> {
    if (!ctx.page || !ctx.url) {
      throw new Error('Page and URL are required');
    }

    await ctx.page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });

    return {
      ...ctx,
      url: ctx.page.url(),
      html: await ctx.page.content(),
      title: await ctx.page.title(),
    };
  },
};

export class GoogleSearchBackend implements SearchBackend {
  readonly name = 'google';

  async search(page: Page, query: string, sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>> {
    const q = `${query} -ai`;
    const start = pageNumber && pageNumber > 1 ? (pageNumber - 1) * 10 : undefined;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en${start !== undefined ? `&start=${start}` : ''}`;

    const result = await runPipeline(
      { url, page, warnings: [], sessionId },
      [
        directSearchStage,
        googleCaptchaStage as Stage,
        cookieConsentStage as Stage,
        sanitizeDomStage as Stage,
        cleanHtmlStage as Stage,
        readabilityStage as Stage,
        toMarkdownStage as Stage,
      ],
      { name: 'search', logContext: { backend: this.name, queryLength: query.length, pageNumber } },
    );

    return { markdown: result.markdown ?? '', url: result.url ?? url, title: result.title ?? '', warnings: result.warnings };
  }
}
