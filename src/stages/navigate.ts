// Page navigation stage with configurable SSRF request interception, redirect counting, and settle delay.
import type { HTTPRequest, HTTPResponse } from 'puppeteer';

import { config } from '../config.ts';
import { validateUrlPolicy } from './url-policy.ts';
import type { Stage, StageContext } from '../types.ts';

export interface NavigateOptions {
  /** Enable request interception to block SSRF-unsafe URLs (default: false). */
  ssrf?: boolean;
  /** Milliseconds to wait after load before extracting content (default: 0). */
  settleDelayMs?: number;
}

/** Returns true if URL policy must be enforced on this request (exported for unit tests). */
export const shouldEnforcePolicy = (isNavigation: boolean, url: string): boolean =>
  isNavigation || url.startsWith('http://') || url.startsWith('https://');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Creates a navigate stage with the given options. */
export function createNavigateStage(options: NavigateOptions = {}): Stage {
  const { ssrf = false, settleDelayMs = 0 } = options;

  return {
    name: 'navigate',
    async execute(ctx: StageContext): Promise<StageContext> {
      if (!ctx.url || !ctx.page) {
        throw new Error('URL and page are required for navigation');
      }

      const page = ctx.page;
      let redirectCount = 0;

      const onResponse = (response: HTTPResponse) => {
        const status = response.status();
        if (status >= 300 && status < 400 && response.headers().location) {
          redirectCount += 1;
        }
      };

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

      if (ssrf) {
        await page.setRequestInterception(true);
        page.on('request', onRequest);
      }
      page.on('response', onResponse);

      try {
        await page.goto(ctx.url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });
        if (settleDelayMs > 0) {
          await sleep(settleDelayMs);
        }

        const cleanup = async () => {
          page.off('response', onResponse);
          if (ssrf) {
            page.off('request', onRequest);
            await page.setRequestInterception(false);
          }
        };

        return {
          ...ctx,
          url: page.url(),
          html: await page.content(),
          title: await page.title(),
          redirectCount,
          cleanups: [...(ctx.cleanups ?? []), cleanup],
        };
      } catch (error) {
        page.off('response', onResponse);
        if (ssrf) {
          page.off('request', onRequest);
          await page.setRequestInterception(false);
        }
        throw error;
      }
    },
  };
}

/** Default navigate stage without SSRF protection (for backwards compatibility). */
export const navigateStage: Stage = createNavigateStage();
