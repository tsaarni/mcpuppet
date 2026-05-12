// Stage that strips non-content elements (scripts, ads, nav, footers, etc.) from the HTML DOM before extraction.
import { parseHTML } from 'linkedom';

import type { Stage } from '../types.ts';

const REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'iframe',
  'form',
  '[class*="sponsor"]',
  '[class*="social"]',
  '[class*="newsletter"]',
  '[id*="newsletter"]',
  '[class*="promo"]',
];

// Word-boundary check: match "ad" as a standalone segment in class/id values
// (e.g. "ad-banner", "top-ad", "ad_container") but not "headroom", "breadcrumb", "loading".
const AD_PATTERN = /(?:^|[\s_-])ad(?:[\s_-]|$)/i;

export const cleanHtmlStage: Stage = {
  name: 'clean-html',
  async execute(ctx) {
    if (!ctx.html) {
      throw new Error('HTML is required');
    }

    const { document } = parseHTML(ctx.html);
    for (const selector of REMOVE_SELECTORS) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        element.remove();
      }
    }

    // Remove elements whose class or id contains "ad" as a word boundary token,
    // but never remove structural elements (html, body, main, article).
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.matches('html, body, main, article')) continue;
      const cls = element.getAttribute('class') ?? '';
      const id = element.getAttribute('id') ?? '';
      if (AD_PATTERN.test(cls) || AD_PATTERN.test(id)) {
        element.remove();
      }
    }

    return { ...ctx, html: document.toString() };
  },
};
