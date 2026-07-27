// DuckDuckGo search backend: navigates to the DuckDuckGo homepage, types the query
// into the search box with human-like delays, and extracts results via a stage pipeline.
import type { Page } from "puppeteer";
import { runPipeline } from "../pipeline.ts";
import { CookieConsentStage } from "../stages/cookie-consent.ts";
import { DuckDuckGoExtractResultsStage } from "../stages/duckduckgo-extract-results.ts";
import { NavigateStage } from "../stages/navigate.ts";
import { ToMarkdownStage } from "../stages/to-markdown.ts";
import { TypeSearchQueryStage } from "../stages/type-search-query.ts";
import type { Stage } from "../types.ts";
import type { SearchBackend, SearchResult } from "./interface.ts";

export class DuckDuckGoSearchBackend implements SearchBackend {
  readonly name = "duckduckgo";

  async search(page: Page, query: string, sessionId?: string): Promise<Omit<SearchResult, "backend">> {
    const url = "https://html.duckduckgo.com/html/";

    const pipeline: Stage[] = [
      new NavigateStage({ ssrf: true }),
      new CookieConsentStage(),
      new TypeSearchQueryStage({ selector: 'input[name="q"]', query, resultSelector: ".result" }),
      new DuckDuckGoExtractResultsStage(),
      new ToMarkdownStage(),
    ];

    const result = await runPipeline({ url, page, warnings: [], sessionId }, pipeline, {
      name: "search",
      logContext: { backend: this.name, queryLength: query.length },
    });

    return {
      markdown: result.markdown ?? "",
      url: result.url ?? url,
      title: result.title ?? "",
      warnings: result.warnings,
    };
  }
}
