// Dismisses cookie consent dialogs from major CMPs (Consent Management Platforms) and uses heuristics
// to catch unknown banners. Works best-effort: never throws, logs dismissal results.
import { dismissCookieConsent } from './cookie-consent.browser.ts';
import { Stage } from '../types.ts';
import type { StageContext } from '../types.ts';
import { logger } from '../util/log.ts';

export class CookieConsentStage extends Stage {
  async execute(ctx: StageContext): Promise<StageContext> {
    if (!ctx.page) {
      return ctx;
    }

    // Known CMP container selectors to wait for (indicates a consent banner is present).
    // Intentionally specific — overly broad selectors (e.g. bare [role="dialog"]) would
    // cause false triggers on login modals or unrelated dialogs.
    const bannerSelectors = [
      '#CybotCookiebotDialog',
      '#onetrust-banner-sdk',
      '.cky-consent-container',
      '#qc-cmp2-container',
      '#truste-consent-track',
      '#didomi-host',
      '.osano-cm-dialog',
      '#cmplz-cookiebanner-container',
      'form[action*="consent"]',
      '[class*="cookie-consent"]',
      '[class*="cookie-banner"]',
      '[id*="cookie-consent"]',
      '[id*="cookie-banner"]',
      'div[role="dialog"][aria-modal="true"]',
      'button#L2AGLb',
    ].join(', ');

    // Wait briefly for any consent banner to appear (catches most async-loaded CMPs)
    try {
      await ctx.page.waitForSelector(bannerSelectors, { timeout: 200 });
    } catch {
      // No banner detected within timeout, nothing to do
      return ctx;
    }

    // Try to dismiss the consent banner
    const result = await ctx.page.evaluate(dismissCookieConsent);

    if (result.dismissed) {
      logger.info({ cmp: result.cmp }, `Dismissed cookie consent dialog (${result.cmp})`);
      // Refresh HTML since DOM may have changed. The dismiss click may trigger a navigation,
      // which destroys the execution context; fall back to the existing HTML in that case.
      try {
        return { ...ctx, html: await ctx.page.content() };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Execution context was destroyed') || msg.includes('Target closed')) {
          return ctx;
        }
        throw err;
      }
    }

    return ctx;
  }
}
