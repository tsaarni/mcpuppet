// Stage that removes invisible and hidden DOM elements (comments, aria-hidden, zero-size, display:none, etc.)
// to prevent concealed content from reaching the LLM.
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

export const sanitizeDomStage: Stage = {
  name: 'sanitize-dom',
  async execute(ctx) {
    if (!ctx.html) {
      throw new Error('HTML is required');
    }

    const { document } = parseHTML(ctx.html);

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

    const allElements = Array.from(document.querySelectorAll('*'));
    for (const element of allElements) {
      const style = element.getAttribute('style') ?? '';
      const ariaHidden = element.getAttribute('aria-hidden');
      const hidden = element.getAttribute('hidden');

      if (ariaHidden === 'true' || hidden !== null || isInvisibleByStyle(style) || isZeroDim(element)) {
        element.remove();
      }
    }

    return { ...ctx, html: document.toString() };
  },
};
