// Detects Google's "unusual traffic" CAPTCHA interstitial and waits for the
// user to solve it manually in the browser window. After resolution, waits for
// search result selectors to appear before handing control back.
import { config } from '../config.ts';
import type { Filter, FilterContext } from '../types.ts';
import { logger } from '../util/log.ts';

const isCaptchaPage = async (ctx: FilterContext): Promise<boolean> =>
  ctx.page!.evaluate(() => {
    const body = document.body?.textContent ?? '';
    return (
      body.includes('unusual traffic') ||
      body.includes('not a robot') ||
      !!document.querySelector('#captcha-form, #recaptcha, form[action*="sorry"]')
    );
  });

export const googleCaptchaFilter: Filter = {
  name: 'google-captcha',
  async execute(ctx: FilterContext): Promise<FilterContext> {
    if (!ctx.page) {
      return ctx;
    }

    if (!(await isCaptchaPage(ctx))) {
      return ctx;
    }

    const timeout = config.requestTimeoutMs;
    logger.warn({ timeout }, 'Google CAPTCHA detected — please solve it in the browser window');

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!(await isCaptchaPage(ctx))) {
        logger.info('Google CAPTCHA resolved');
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Wait for actual search results to render after CAPTCHA redirect.
        await ctx.page.waitForSelector('div.g, [data-hveid], div[data-ved]', { timeout: config.requestTimeoutMs }).catch(() => {
          logger.warn('Timed out waiting for search results after CAPTCHA resolution');
        });
        return ctx;
      }
    }

    logger.warn('Google CAPTCHA was not resolved within timeout');
    ctx.warnings.push('Google CAPTCHA was not resolved within timeout — results may be empty.');
    return ctx;
  },
};
