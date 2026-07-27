// Google search backend: navigates to the Google homepage, types the query
// into the search box with human-like delays, and extracts results via a stage pipeline.
import type { Page } from "puppeteer";
import { runPipeline } from "../pipeline.ts";
import { CookieConsentStage } from "../stages/cookie-consent.ts";
import { GoogleCaptchaStage } from "../stages/google-captcha.ts";
import { GoogleExtractResultsStage } from "../stages/google-extract-results.ts";
import { NavigateStage } from "../stages/navigate.ts";
import { ToMarkdownStage } from "../stages/to-markdown.ts";
import { TypeSearchQueryStage } from "../stages/type-search-query.ts";
import type { Stage } from "../types.ts";
import type { SearchBackend, SearchResult } from "./interface.ts";

export class GoogleSearchBackend implements SearchBackend {
  readonly name = "google";

  async search(page: Page, query: string, sessionId?: string): Promise<Omit<SearchResult, "backend">> {
    // Appending -ai suppresses Google's AI Overview summary from appearing in results.
    // Note: this may interfere with searches for AI-related topics.
    const q = `${query} -ai`;
    const url = "https://www.google.com/?hl=en";

    const pipeline: Stage[] = [
      new NavigateStage({ ssrf: true }),
      new GoogleCaptchaStage(),
      new CookieConsentStage(),
      new TypeSearchQueryStage({ selector: 'textarea[name="q"]', query: q, resultSelector: "div.g, [data-hveid]" }),
      new GoogleExtractResultsStage(),
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
