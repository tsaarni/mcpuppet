// Filter that uses Mozilla Readability to extract the main article content from raw HTML, discarding boilerplate.
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

import type { Filter } from '../types.ts';

export const readabilityFilter: Filter = {
  name: 'readability',
  async execute(ctx) {
    if (!ctx.html || !ctx.url) {
      throw new Error('HTML and URL are required for readability');
    }

    const { document } = parseHTML(ctx.html);
    const article = new Readability(document as unknown as Document, { keepClasses: false }).parse();

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
