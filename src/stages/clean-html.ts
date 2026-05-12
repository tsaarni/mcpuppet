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
  '[class*="ad"]',
  '[id*="ad"]',
  '[class*="sponsor"]',
  '[class*="social"]',
  '[class*="newsletter"]',
  '[id*="newsletter"]',
  '[class*="promo"]',
];

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

    return { ...ctx, html: document.toString() };
  },
};
