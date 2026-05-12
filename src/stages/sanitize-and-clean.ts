// Parses HTML once, strips hidden/invisible elements (sanitize) and
// boilerplate selectors (clean), then passes the live document on the context.
import { parseHTML } from 'linkedom';

import type { Stage } from '../types.ts';

const isInvisibleByStyle = (style: string): boolean => {
  const normalized = style.replace(/\s+/g, '').toLowerCase();
  return (
    normalized.includes('display:none') ||
    normalized.includes('visibility:hidden') ||
    normalized.includes('opacity:0') ||
    normalized.includes('width:0') ||
    normalized.includes('height:0') ||
    /font-size:0(px|em|%)?(?:[;'"]|$)/.test(normalized) ||
    normalized.includes('color:transparent') ||
    normalized.includes('text-indent:-') ||
    normalized.includes('clip-path:inset(100')
  );
};

const isZeroDim = (el: Element): boolean => {
  const width = el.getAttribute('width');
  const height = el.getAttribute('height');
  return width === '0' || height === '0';
};

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

const AD_PATTERN = /(?:^|[\s_-])ad(?:[\s_-]|$)/i;

export const sanitizeAndCleanStage: Stage = {
  name: 'sanitize-and-clean',
  async execute(ctx) {
    if (!ctx.html) {
      throw new Error('HTML is required');
    }

    const { document } = parseHTML(ctx.html);

    // --- Sanitize: remove comments ---
    const walker = document.createTreeWalker(document, 128);
    const comments: Comment[] = [];
    let current = walker.nextNode() as Comment | null;
    while (current) {
      comments.push(current);
      current = walker.nextNode() as Comment | null;
    }
    for (const comment of comments) {
      comment.remove();
    }

    // --- Sanitize: remove hidden/invisible elements ---
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const style = element.getAttribute('style') ?? '';
      const ariaHidden = element.getAttribute('aria-hidden');
      const hidden = element.getAttribute('hidden');

      if (ariaHidden === 'true' || hidden !== null || isInvisibleByStyle(style) || isZeroDim(element)) {
        element.remove();
      }
    }

    // --- Clean: remove boilerplate selectors ---
    for (const selector of REMOVE_SELECTORS) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        element.remove();
      }
    }

    // --- Clean: remove ad elements ---
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.matches('html, body, main, article')) continue;
      const cls = element.getAttribute('class') ?? '';
      const id = element.getAttribute('id') ?? '';
      if (AD_PATTERN.test(cls) || AD_PATTERN.test(id)) {
        element.remove();
      }
    }

    return { ...ctx, html: document.toString(), document };
  },
};
