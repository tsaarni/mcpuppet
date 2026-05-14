// DuckDuckGo search backend: navigates directly to search results URL
// and converts the results page to markdown via a stage pipeline.
import type { Page } from 'puppeteer';

import { CookieConsentStage } from '../stages/cookie-consent.ts';
import { DuckDuckGoExtractResultsStage } from '../stages/duckduckgo-extract-results.ts';
import { NavigateStage } from '../stages/navigate.ts';
import { ToMarkdownStage } from '../stages/to-markdown.ts';
import { runPipeline } from '../pipeline.ts';
import { Stage } from '../types.ts';
import type { SearchBackend, SearchResult } from './interface.ts';

export class DuckDuckGoSearchBackend implements SearchBackend {
  readonly name = 'duckduckgo';

  async search(page: Page, query: string, sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>> {
    const params = new URLSearchParams({ q: query });
    if (pageNumber && pageNumber > 1) {
      params.set('s', String((pageNumber - 1) * 30));
    }
    const url = `https://html.duckduckgo.com/html/?${params.toString()}`;

    const pipeline: Stage[] = [
      new NavigateStage({ ssrf: true }),
      new CookieConsentStage(),
      new DuckDuckGoExtractResultsStage(),
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
