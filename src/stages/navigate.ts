// Page navigation stage with configurable SSRF request interception, redirect counting, and settle delay.
import type { HTTPRequest, HTTPResponse } from 'puppeteer';

import { config } from '../config.ts';
import { resolveAndValidateDns, validateUrlPolicy } from './url-policy.ts';
import type { Stage, StageContext } from '../types.ts';
import { logger } from '../util/log.ts';

/** Ignore errors that are expected when a request is already handled or the page is closed. */
function ignoreRequestError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('Request is already handled') && !msg.includes('Target closed')) {
    logger.warn({ err }, 'Unexpected error handling intercepted request');
  }
}

export interface NavigateOptions {
  /** Enable request interception to block SSRF-unsafe URLs (default: false). */
  ssrf?: boolean;
  /** Milliseconds to wait after load before extracting content (default: 0). */
  settleDelayMs?: number;
}

/** Returns true if URL policy must be enforced on this request (exported for unit tests). */
export function shouldEnforcePolicy(isNavigation: boolean, url: string): boolean {
  return isNavigation || url.startsWith('http://') || url.startsWith('https://');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
          const validate = async () => {
            try {
              const parsed = validateUrlPolicy(request.url());
              // Re-resolve DNS here to close the TOCTOU window: Chromium performs its own
              // DNS lookup after our pre-navigation check, so a malicious DNS server could
              // return a public IP for the initial validation and a private IP for the actual
              // request. Re-resolving on every navigation request prevents this rebinding attack.
              if (request.isNavigationRequest()) {
                await resolveAndValidateDns(parsed);
              }
              await request.continue();
            } catch (policyErr) {
              // If policy validation failed, abort; if abort itself fails, log it.
              const msg = policyErr instanceof Error ? policyErr.message : String(policyErr);
              const isRequestHandled = msg.includes('Request is already handled') || msg.includes('Target closed');
              if (!isRequestHandled) {
                await request.abort('blockedbyclient').catch(ignoreRequestError);
              }
            }
          };
          validate().catch(ignoreRequestError);
        } else {
          request.continue().catch(ignoreRequestError);
        }
      };

      if (ssrf) {
        page.on('request', onRequest);
        await page.setRequestInterception(true);
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
