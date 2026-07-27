// Stage that uses Mozilla Readability to extract the main article content from raw HTML, discarding boilerplate.

import { isProbablyReaderable, Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ParsedDocument, StageContext } from "../types.ts";
import { Stage } from "../types.ts";

const CONTENT_RATIO_THRESHOLD = 0.4;

export class ReadabilityStage extends Stage {
  execute(ctx: StageContext): StageContext {
    if (!ctx.html || !ctx.url) {
      throw new Error("HTML and URL are required for readability");
    }

    const doc = (ctx.document ?? parseHTML(ctx.html).document) as unknown as ParsedDocument;

    if (!isProbablyReaderable(doc)) {
      ctx.warnings.push("Page is not article-like; skipping Readability extraction.");
      return ctx;
    }

    let article: { content?: string | null; title?: string | null } | null;
    try {
      article = new Readability(doc, { keepClasses: false }).parse();
    } catch {
      ctx.warnings.push("Readability could not extract main content; using full HTML body.");
      return ctx;
    }

    if (!article?.content) {
      ctx.warnings.push("Readability could not extract main content; using full HTML body.");
      return ctx;
    }

    // Safety net: if Readability dropped too much content, fall back to sanitized HTML.
    let inputText = "";
    try {
      inputText = doc.body?.textContent ?? "";
    } catch {
      // Guard against linkedom Document corruption: the DOM manipulation in
      // SanitizeAndCleanStage can break linkedom's internal linked-list structure,
      // causing document.documentElement to become null. Fall back gracefully.
      ctx.warnings.push("Could not access document body; using full sanitized HTML.");
      return ctx;
    }
    let outputDoc: ParsedDocument;
    try {
      outputDoc = parseHTML(article.content).document as unknown as ParsedDocument;
    } catch {
      ctx.warnings.push("Readability content could not be parsed; using full sanitized HTML.");
      return ctx;
    }
    const outputText = outputDoc.body?.textContent ?? "";
    if (inputText.length > 0 && outputText.length / inputText.length < CONTENT_RATIO_THRESHOLD) {
      ctx.warnings.push("Readability dropped significant content; using full sanitized HTML.");
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
