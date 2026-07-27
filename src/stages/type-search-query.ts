// Reusable stage that injects a search query into an input field via DOM and submits it.

import { config } from "../config.ts";
import type { StageContext } from "../types.ts";
import { Stage } from "../types.ts";
import { logger } from "../util/log.ts";

export interface TypeSearchQueryOptions {
  selector: string;
  query: string;
  resultSelector: string;
}

export class TypeSearchQueryStage extends Stage {
  private readonly options: TypeSearchQueryOptions;

  constructor(options: TypeSearchQueryOptions) {
    super();
    this.options = options;
  }

  async execute(ctx: StageContext): Promise<StageContext> {
    if (!ctx.page) {
      throw new Error("Page is required for typing search query");
    }

    const { page } = ctx;
    const { selector, query, resultSelector } = this.options;

    logger.debug({ selector }, "Waiting for search input field");
    await page.waitForSelector(selector, { timeout: config.requestTimeoutMs });

    // Inject the query directly via the DOM instead of typing character by character.
    // This avoids O(n) per-keystroke puppet delays and still triggers the search form.
    logger.debug({ selector, queryLength: query.length }, "Injecting search query via DOM");
    await page.evaluate(
      ({ sel, q }) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (!input) return;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, q);
        } else {
          input.value = q;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { sel: selector, q: query },
    );

    logger.debug("Pressing Enter to submit search");
    await page.keyboard.press("Enter");

    logger.debug({ resultSelector }, "Waiting for search results");
    await page.waitForSelector(resultSelector, { timeout: config.requestTimeoutMs });

    return { ...ctx, url: page.url(), html: await page.content(), title: await page.title() };
  }
}
