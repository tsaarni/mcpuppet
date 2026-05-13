// Stage that uses Mozilla Readability to extract the main article content from raw HTML, discarding boilerplate.
import { parseHTML } from 'linkedom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';

import type { Stage } from '../types.ts';

const CONTENT_RATIO_THRESHOLD = 0.4;

export const readabilityStage: Stage = {
  name: 'readability',
  execute(ctx) {
    if (!ctx.html || !ctx.url) {
      return Promise.reject(new Error('HTML and URL are required for readability'));
    }

    const doc = ctx.document ?? parseHTML(ctx.html).document;

    if (!isProbablyReaderable(doc as unknown as Document)) {
      ctx.warnings.push('Page is not article-like; skipping Readability extraction.');
      return Promise.resolve(ctx);
    }

    let article: { content?: string | null; title?: string | null } | null;
    try {
      article = new Readability(doc as unknown as Document, { keepClasses: false }).parse();
    } catch {
      ctx.warnings.push('Readability could not extract main content; using full HTML body.');
      return Promise.resolve(ctx);
    }

    if (!article?.content) {
      ctx.warnings.push('Readability could not extract main content; using full HTML body.');
      return Promise.resolve(ctx);
    }

    // Safety net: if Readability dropped too much content, fall back to sanitized HTML.
    const inputText = (doc as unknown as { body?: { textContent?: string } }).body?.textContent ?? '';
    const outputDoc = parseHTML(article.content).document;
    const outputText = (outputDoc as unknown as { body?: { textContent?: string } }).body?.textContent ?? '';
    if (inputText.length > 0 && outputText.length / inputText.length < CONTENT_RATIO_THRESHOLD) {
      ctx.warnings.push('Readability dropped significant content; using full sanitized HTML.');
      return Promise.resolve(ctx);
    }

    return Promise.resolve({
      ...ctx,
      html: article.content,
      title: article.title ?? ctx.title,
      document: undefined,
    });
  },
};
