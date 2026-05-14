// Parses HTML once, strips hidden/invisible elements (sanitize) and
// boilerplate selectors (clean), then passes the live document on the context.
import { parseHTML } from 'linkedom';

import { Stage } from '../types.ts';
import type { ParsedDocument, StageContext } from '../types.ts';

function isInvisibleByStyle(style: string): boolean {
  const normalized = style.replaceAll(/\s+/g, '').toLowerCase();
  return (
    /(?:^|;)display:none/.test(normalized) ||
    normalized.includes('visibility:hidden') ||
    /(?:^|;)opacity:0(?:[;\s'"]|$)/.test(normalized) ||
    /(?:^|;)width:0/.test(normalized) ||
    /(?:^|;)height:0/.test(normalized) ||
    /font-size:0(px|em|%)?(?:[;'"]|$)/.test(normalized) ||
    /(?:^|;)color:transparent/.test(normalized) ||
    normalized.includes('text-indent:-') ||
    normalized.includes('clip-path:inset(100')
  );
}

function isZeroDim(el: Element): boolean {
  const width = el.getAttribute('width');
  const height = el.getAttribute('height');
  return width === '0' || height === '0';
}

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

export class SanitizeAndCleanStage extends Stage {
  execute(ctx: StageContext): StageContext {
    if (!ctx.html) {
      throw new Error('HTML is required');
    }

    const document = parseHTML(ctx.html).document as unknown as ParsedDocument;

    // --- Sanitize: remove comments ---
    const walker = document.createTreeWalker(document, 128);
    const comments: Comment[] = [];
    for (let current = walker.nextNode() as Comment | null; current; current = walker.nextNode() as Comment | null) {
      comments.push(current);
    }
    for (const comment of comments) {
      comment.remove();
    }

    // --- Sanitize + Clean: remove hidden/invisible and ad elements ---
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.matches('html, body, main, article')) continue;

      const style = element.getAttribute('style') ?? '';
      const ariaHidden = element.getAttribute('aria-hidden');
      const hidden = element.getAttribute('hidden');
      const cls = element.getAttribute('class') ?? '';
      const id = element.getAttribute('id') ?? '';

      if (
        ariaHidden === 'true' ||
        hidden !== null ||
        isInvisibleByStyle(style) ||
        isZeroDim(element) ||
        AD_PATTERN.test(cls) ||
        AD_PATTERN.test(id)
      ) {
        element.remove();
      }
    }

    // --- Clean: remove boilerplate selectors ---
    for (const selector of REMOVE_SELECTORS) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        element.remove();
      }
    }

    return { ...ctx, html: document.toString(), document };
  }
}
