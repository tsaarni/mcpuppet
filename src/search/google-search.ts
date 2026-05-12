// Google search backend: navigates to google.com and converts the page to markdown via a stage pipeline.
// Steps: navigate → CAPTCHA → consent → sanitize-dom → clean-html → readability → to-markdown.
import type { Page } from 'puppeteer';

import { cleanHtmlStage } from '../stages/clean-html.ts';
import { googleCaptchaStage } from '../stages/google-captcha.ts';
import { cookieConsentStage } from '../stages/cookie-consent.ts';
import { navigateStage } from '../stages/navigate.ts';
import { readabilityStage } from '../stages/readability.ts';
import { sanitizeDomStage } from '../stages/sanitize-dom.ts';
import { toMarkdownStage } from '../stages/to-markdown.ts';
import { urlPolicyStage } from '../stages/url-policy.ts';
import { runPipeline } from '../pipeline.ts';
import type { Stage } from '../types.ts';
import type { SearchBackend, SearchResult } from './interface.ts';

export class GoogleSearchBackend implements SearchBackend {
  readonly name = 'google';

  async search(page: Page, query: string, sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>> {
    const start = pageNumber && pageNumber > 1 ? (pageNumber - 1) * 10 : undefined;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}${start !== undefined ? `&start=${start}` : ''}`;

    const result = await runPipeline(
      { url, page, warnings: [], sessionId },
      [
        urlPolicyStage as Stage,
        navigateStage,
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
