// Dismisses Google's cookie consent dialog if present on the page.
// Works across locales by matching common button IDs, aria-labels, and text patterns.
import type { Filter, FilterContext } from '../types.ts';
import { logger } from '../util/log.ts';

export const googleConsentFilter: Filter = {
  name: 'google-consent',
  async execute(ctx: FilterContext): Promise<FilterContext> {
    if (!ctx.page) {
      return ctx;
    }

    const dismissed = await ctx.page.evaluate(() => {
      const consentSelectors = [
        'button#L2AGLb',                         // "Accept all" on google.com
        'button[aria-label*="Accept"]',
        'button[aria-label*="Reject"]',
        'form[action*="consent"] button',
        'div[role="dialog"] button',
      ];

      for (const selector of consentSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() ?? '';
          if (
            text.includes('accept') ||
            text.includes('reject all') ||
            text.includes('hyväksy') ||
            text.includes('hylkää')
          ) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    });

    if (dismissed) {
      logger.info('Dismissed Google cookie consent dialog');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return ctx;
  },
};
