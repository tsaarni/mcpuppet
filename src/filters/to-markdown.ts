// Filter that converts HTML to Markdown using Turndown, with custom rules for links and image alt text.
import TurndownService from 'turndown';

import type { Filter } from '../types.ts';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

turndown.addRule('simple-links', {
  filter: 'a',
  replacement(content, node) {
    const href = (node as Element).getAttribute('href') ?? '';
    const text = content.trim() || href;
    if (!href) {
      return text;
    }
    return `[${text}](${href})`;
  },
});

turndown.addRule('images-with-substantial-alt', {
  filter: 'img',
  replacement(_content, node) {
    const alt = ((node as Element).getAttribute('alt') ?? '').trim();
    return alt.length >= 20 ? alt : '';
  },
});

export const toMarkdownFilter: Filter = {
  name: 'to-markdown',
  async execute(ctx) {
    if (!ctx.html) {
      throw new Error('HTML is required for markdown conversion');
    }

    return {
      ...ctx,
      markdown: turndown.turndown(ctx.html).trim(),
    };
  },
};
