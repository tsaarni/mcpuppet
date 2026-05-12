// Dismisses cookie consent dialogs from major CMPs (Consent Management Platforms) and uses heuristics
// to catch unknown banners. Works best-effort: never throws, logs dismissal results.
import type { Stage, StageContext } from '../types.ts';
import { logger } from '../util/log.ts';

export const cookieConsentStage: Stage = {
  name: 'cookie-consent',
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

    // Wait briefly for any consent banner to appear (they often load async)
    try {
      await ctx.page.waitForSelector(bannerSelectors, { timeout: 2000 });
    } catch {
      // No banner detected, nothing to do
      return ctx;
    }

    // Try to dismiss the consent banner
    // NOTE: Uses evaluate(string) instead of evaluate(function) to avoid tsx/esbuild
    // --keep-names injecting __name references that don't exist in the browser context.
    const result = await ctx.page.evaluate(`(()=>{
      const isVisible = (el) => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };

      const knownCmpSelectors = [
        { selector: '#CybotCookiebotDialogBodyButtonAccept', cmp: 'CookieBot' },
        { selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', cmp: 'CookieBot' },
        { selector: '#onetrust-accept-btn-handler', cmp: 'OneTrust' },
        { selector: '.cky-btn-accept', cmp: 'CookieYes' },
        { selector: null, cmp: 'Quantcast', shadowRoot: true },
        { selector: '#truste-consent-button', cmp: 'TrustArc' },
        { selector: '#didomi-notice-agree-button', cmp: 'Didomi' },
        { selector: '.osano-cm-accept-all', cmp: 'Osano' },
        { selector: '.cmplz-accept', cmp: 'Complianz' },
        { selector: 'button#L2AGLb', cmp: 'Google' },
        { selector: 'button[aria-label*="Accept"]', cmp: 'Google' },
        { selector: 'form[action*="consent"] button', cmp: 'Google' },
      ];

      for (const entry of knownCmpSelectors) {
        if (entry.shadowRoot) {
          const container = document.querySelector('div#qc-cmp2-container');
          if (container && container.shadowRoot) {
            const btn = container.shadowRoot.querySelector('.qc-cmp2-summary-buttons button[mode="primary"]');
            if (btn && isVisible(btn)) {
              btn.click();
              return { dismissed: true, cmp: entry.cmp };
            }
          }
        } else if (entry.selector) {
          const btn = document.querySelector(entry.selector);
          if (btn && isVisible(btn)) {
            btn.click();
            return { dismissed: true, cmp: entry.cmp };
          }
        }
      }

      const consentContainerSelectors = [
        '[class*="consent"]',
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[id*="consent"]',
        '[class*="gdpr"]',
        'form[action*="consent"]',
        '[role="dialog"][aria-modal="true"]',
        '[role="dialog"][class*="cookie"], [role="dialog"][class*="consent"], [role="dialog"][class*="gdpr"]',
      ];

      const acceptPatterns = [
        (t) => t.includes('accept all'),
        (t) => t.includes('accept cookies'),
        (t) => t.includes('allow all'),
        (t) => t.includes('allow cookies'),
        (t) => t.includes('got it'),
        (t) => t.includes('i agree'),
        (t) => /\\bagree\\b/.test(t),
        (t) => /\\baccept\\b/.test(t),
        (t) => /^ok$/i.test(t),
        (t) => t.includes('hyv\\u00e4ksy kaikki'),
        (t) => t.includes('alle akzeptieren'),
        (t) => t.includes('tout accepter'),
        (t) => t.includes('aceptar todo'),
        (t) => t.includes('accetta tutto'),
        (t) => t.includes('acceptera alla'),
        (t) => t.includes('alles accepteren'),
        (t) => t.includes('aceitar tudo'),
      ];

      for (const containerSelector of consentContainerSelectors) {
        const containers = document.querySelectorAll(containerSelector);
        for (const container of containers) {
          if (!isVisible(container)) continue;
          const buttons = container.querySelectorAll('button, a[role="button"], a.button, [role="button"]');
          for (const btn of buttons) {
            const text = (btn.textContent || '').toLowerCase().trim();
            if (acceptPatterns.some((p) => p(text))) {
              if (isVisible(btn)) {
                btn.click();
                return { dismissed: true, cmp: 'heuristic' };
              }
            }
          }
        }
      }

      return { dismissed: false, cmp: null };
    })()`) as { dismissed: boolean; cmp: string | null };

    if (result.dismissed) {
      logger.info({ cmp: result.cmp }, `Dismissed cookie consent dialog (${result.cmp})`);
      // Wait for the banner to disappear
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Refresh HTML since DOM may have changed
      ctx.html = await ctx.page.content();
    }

    return ctx;
  },
};
