// Google search backend: navigates directly to search results URL
// and converts the results page to markdown via a stage pipeline.
import type { Page } from 'puppeteer';

import { googleCaptchaStage } from '../stages/google-captcha.ts';
import { cookieConsentStage } from '../stages/cookie-consent.ts';
import { googleExtractResultsStage } from '../stages/google-extract-results.ts';
import { createNavigateStage } from '../stages/navigate.ts';
import { toMarkdownStage } from '../stages/to-markdown.ts';
import { runPipeline } from '../pipeline.ts';
import type { SearchBackend, SearchResult } from './interface.ts';

export class GoogleSearchBackend implements SearchBackend {
  readonly name = 'google';

  async search(page: Page, query: string, sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>> {
    // Appending -ai suppresses Google's AI Overview summary from appearing in results.
    // Note: this may interfere with searches for AI-related topics.
    const q = `${query} -ai`;
    const start = pageNumber && pageNumber > 1 ? (pageNumber - 1) * 10 : undefined;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en${start !== undefined ? `&start=${start}` : ''}`;

    const result = await runPipeline(
      { url, page, warnings: [], sessionId },
      [
        createNavigateStage({ ssrf: true }),
        googleCaptchaStage,
        cookieConsentStage,
        googleExtractResultsStage,
        toMarkdownStage,
      ],
      { name: 'search', logContext: { backend: this.name, queryLength: query.length, pageNumber } },
    );

    return { markdown: result.markdown ?? '', url: result.url ?? url, title: result.title ?? '', warnings: result.warnings };
  }
}
