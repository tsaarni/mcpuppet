// Stage that uses Mozilla Readability to extract the main article content from raw HTML, discarding boilerplate.
import { parseHTML } from 'linkedom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';

import { Stage } from '../types.ts';
import type { ParsedDocument, StageContext } from '../types.ts';

const CONTENT_RATIO_THRESHOLD = 0.4;

export class ReadabilityStage extends Stage {
  execute(ctx: StageContext): StageContext {
    if (!ctx.html || !ctx.url) {
      throw new Error('HTML and URL are required for readability');
    }

    const doc = (ctx.document ?? parseHTML(ctx.html).document) as unknown as ParsedDocument;

    if (!isProbablyReaderable(doc)) {
      ctx.warnings.push('Page is not article-like; skipping Readability extraction.');
      return ctx;
    }

    let article: { content?: string | null; title?: string | null } | null;
    try {
      article = new Readability(doc, { keepClasses: false }).parse();
    } catch {
      ctx.warnings.push('Readability could not extract main content; using full HTML body.');
      return ctx;
    }

    if (!article?.content) {
      ctx.warnings.push('Readability could not extract main content; using full HTML body.');
      return ctx;
    }

    // Safety net: if Readability dropped too much content, fall back to sanitized HTML.
    const inputText = doc.body?.textContent ?? '';
    const outputDoc = parseHTML(article.content).document;
    const outputText = outputDoc.body?.textContent ?? '';
    if (inputText.length > 0 && outputText.length / inputText.length < CONTENT_RATIO_THRESHOLD) {
      ctx.warnings.push('Readability dropped significant content; using full sanitized HTML.');
      return ctx;
    }

    return {
      ...ctx,
      html: article.content,
      title: article.title ?? ctx.title,
      document: undefined,
    };
  }
}
