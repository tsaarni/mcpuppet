// Stage that extracts Google search results directly from the page DOM,
// preserving title links that Readability would otherwise strip.
import { extractGoogleResults } from './google-extract-results.browser.ts';
import { Stage } from '../types.ts';
import type { StageContext } from '../types.ts';

export class GoogleExtractResultsStage extends Stage {
  async execute(ctx: StageContext): Promise<StageContext> {
    if (!ctx.page) {
      throw new Error('Page is required for Google result extraction');
    }

    const entries = await ctx.page.evaluate(extractGoogleResults);

    if (entries.length === 0) {
      ctx.warnings.push('Google result extraction found no results; falling back to raw HTML.');
      return ctx;
    }

    // Build simple HTML that to-markdown can convert, with links preserved.
    const html = entries
      .map((e) => `<h3><a href="${escapeAttr(e.url)}">${escapeHtml(e.title)}</a></h3>\n<p>${escapeHtml(e.snippet)}</p>`)
      .join('\n');

    return { ...ctx, html };
  }
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}
