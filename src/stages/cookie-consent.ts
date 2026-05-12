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
    ].join(', ');

    // Wait briefly for any consent banner to appear (they often load async)
    try {
      await ctx.page.waitForSelector(bannerSelectors, { timeout: 2000 });
    } catch {
      // No banner detected, nothing to do
      return ctx;
    }

    // Try to dismiss the consent banner
    const result = await ctx.page.evaluate(() => {
      // Visibility check that works for position:fixed elements (most cookie banners).
      const isVisible = (el: Element): boolean => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };

      // Known CMP accept button selectors (in priority order)
      const knownCmpSelectors = [
        // CookieBot
        { selector: '#CybotCookiebotDialogBodyButtonAccept', cmp: 'CookieBot' },
        { selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', cmp: 'CookieBot' },
        // OneTrust
        { selector: '#onetrust-accept-btn-handler', cmp: 'OneTrust' },
        // CookieYes
        { selector: '.cky-btn-accept', cmp: 'CookieYes' },
        // Quantcast (check shadow DOM)
        { selector: null, cmp: 'Quantcast', shadowRoot: true },
        // TrustArc
        { selector: '#truste-consent-button', cmp: 'TrustArc' },
        // Didomi
        { selector: '#didomi-notice-agree-button', cmp: 'Didomi' },
        // Osano
        { selector: '.osano-cm-accept-all', cmp: 'Osano' },
        // Complianz
        { selector: '.cmplz-accept', cmp: 'Complianz' },
        // Google consent
        { selector: 'button#L2AGLb', cmp: 'Google' },
        { selector: 'button[aria-label*="Accept"]', cmp: 'Google' },
        { selector: 'form[action*="consent"] button', cmp: 'Google' },
      ];

      // Try known CMP selectors first
      for (const entry of knownCmpSelectors) {
        if (entry.shadowRoot) {
          // Special handling for Quantcast shadow DOM
          const container = document.querySelector('div#qc-cmp2-container');
          if (container?.shadowRoot) {
            const btn = container.shadowRoot.querySelector('.qc-cmp2-summary-buttons button[mode="primary"]');
            if (btn && isVisible(btn)) {
              (btn as HTMLElement).click();
              return { dismissed: true, cmp: entry.cmp };
            }
          }
        } else if (entry.selector) {
          const btn = document.querySelector(entry.selector);
          if (btn && isVisible(btn)) {
            (btn as HTMLElement).click();
            return { dismissed: true, cmp: entry.cmp };
          }
        }
      }

      // Heuristic fallback: look for accept-like buttons in consent-like containers
      const consentContainerSelectors = [
        '[class*="consent"]',
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[id*="consent"]',
        '[class*="gdpr"]',
        '[role="dialog"][class*="cookie"], [role="dialog"][class*="consent"], [role="dialog"][class*="gdpr"]',
      ];

      // Multi-word patterns use includes(); single-word patterns use word-boundary regex.
      const acceptPatterns: { test: (text: string) => boolean }[] = [
        { test: (t) => t.includes('accept all') },
        { test: (t) => t.includes('accept cookies') },
        { test: (t) => t.includes('allow all') },
        { test: (t) => t.includes('allow cookies') },
        { test: (t) => t.includes('got it') },
        { test: (t) => t.includes('i agree') },
        { test: (t) => /\bagree\b/.test(t) },
        { test: (t) => /\baccept\b/.test(t) },
        { test: (t) => /^ok$/i.test(t) },
        { test: (t) => t.includes('hyväksy') },
        { test: (t) => /\bsalli\b/.test(t) },
      ];

      for (const containerSelector of consentContainerSelectors) {
        const containers = document.querySelectorAll(containerSelector);
        for (const container of containers) {
          if (!isVisible(container)) {
            continue;
          }

          const buttons = container.querySelectorAll('button, a[role="button"], a.button, [role="button"]');
          for (const btn of buttons) {
            const text = (btn.textContent ?? '').toLowerCase().trim();
            if (acceptPatterns.some((pattern) => pattern.test(text))) {
              if (isVisible(btn)) {
                (btn as HTMLElement).click();
                return { dismissed: true, cmp: 'heuristic' };
              }
            }
          }
        }
      }

      return { dismissed: false, cmp: null };
    });

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
