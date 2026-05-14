// Google search backend: navigates directly to search results URL
// and converts the results page to markdown via a stage pipeline.
import type { Page } from 'puppeteer';

import { GoogleCaptchaStage } from '../stages/google-captcha.ts';
import { CookieConsentStage } from '../stages/cookie-consent.ts';
import { GoogleExtractResultsStage } from '../stages/google-extract-results.ts';
import { NavigateStage } from '../stages/navigate.ts';
import { ToMarkdownStage } from '../stages/to-markdown.ts';
import { runPipeline } from '../pipeline.ts';
import { Stage } from '../types.ts';
import type { SearchBackend, SearchResult } from './interface.ts';

export class GoogleSearchBackend implements SearchBackend {
  readonly name = 'google';

  async search(page: Page, query: string, sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>> {
    // Appending -ai suppresses Google's AI Overview summary from appearing in results.
    // Note: this may interfere with searches for AI-related topics.
    const q = `${query} -ai`;
    const start = pageNumber && pageNumber > 1 ? (pageNumber - 1) * 10 : undefined;
    const startParam = start === undefined ? '' : `&start=${start}`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en${startParam}`;

    const pipeline: Stage[] = [
      new NavigateStage({ ssrf: true }),
      new GoogleCaptchaStage(),
      new CookieConsentStage(),
      new GoogleExtractResultsStage(),
      new ToMarkdownStage(),
    ];

    const result = await runPipeline(
      { url, page, warnings: [], sessionId },
      pipeline,
      { name: 'search', logContext: { backend: this.name, queryLength: query.length, pageNumber } },
    );

    return { markdown: result.markdown ?? '', url: result.url ?? url, title: result.title ?? '', warnings: result.warnings };
  }
}
