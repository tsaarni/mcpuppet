// Stage that uses Mozilla Readability to extract the main article content from raw HTML, discarding boilerplate.
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

import type { Stage } from '../types.ts';

export const readabilityStage: Stage = {
  name: 'readability',
  async execute(ctx) {
    if (!ctx.html || !ctx.url) {
      throw new Error('HTML and URL are required for readability');
    }

    let article: { content?: string | null; title?: string | null } | null = null;
    try {
      const { document } = parseHTML(ctx.html);
      article = new Readability(document as unknown as Document, { keepClasses: false }).parse();
    } catch {
      ctx.warnings.push('Readability could not extract main content; using full HTML body.');
      return ctx;
    }

    if (!article?.content) {
      ctx.warnings.push('Readability could not extract main content; using full HTML body.');
      return ctx;
    }

    return {
      ...ctx,
      html: article.content,
      title: article.title ?? ctx.title,
    };
  },
};
