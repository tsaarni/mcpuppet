// Stage that converts HTML to Markdown using Turndown, with custom rules for links and image alt text.
import TurndownService from 'turndown';

import type { Stage } from '../types.ts';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

turndown.addRule('simple-links', {
  filter: 'a',
  replacement(content, node) {
    const href = (node as Element).getAttribute('href') ?? '';
    const text = content.trim() || href;
    if (!href) {
      return text;
    }
    // Block-level content inside a link can't be wrapped in []() syntax.
    // Render the content as-is and append the URL as a proper link.
    if (text.includes('\n')) {
      return `\n\n${text}\n[${href}](${href})\n\n`;
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

export const toMarkdownStage: Stage = {
  name: 'to-markdown',
  execute(ctx) {
    if (!ctx.html) {
      throw new Error('HTML is required for markdown conversion');
    }

    return Promise.resolve({
      ...ctx,
      markdown: turndown.turndown(ctx.html).trim(),
    });
  },
};
