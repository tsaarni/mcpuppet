// Stage that extracts Google search results directly from the page DOM,
// preserving title links that Readability would otherwise strip.
import type { Stage, StageContext } from '../types.ts';

interface SearchEntry {
  title: string;
  url: string;
  snippet: string;
}

export const googleExtractResultsStage: Stage = {
  name: 'google-extract-results',
  async execute(ctx: StageContext): Promise<StageContext> {
    if (!ctx.page) {
      throw new Error('Page is required for Google result extraction');
    }

    const entries: SearchEntry[] = await ctx.page.evaluate(() => {
      const results: { title: string; url: string; snippet: string }[] = [];
      // Google wraps each organic result in a div.g or a [data-snc] container with an <a> containing <h3>.
      const containers = document.querySelectorAll('div.g, div[data-snc]');
      for (const container of containers) {
        const link = container.querySelector('a[href]');
        const heading = container.querySelector('h3');
        if (!link || !heading) continue;
        const href = link.getAttribute('href') ?? '';
        if (!href || href.startsWith('#') || href.startsWith('/search')) continue;
        const title = heading.textContent?.trim() ?? '';
        // Snippet is typically in a div with class containing "VwiC3b" or a span inside the result.
        const snippetEl = container.querySelector('[data-sncf] span, .VwiC3b, [style*="-webkit-line-clamp"]');
        const snippet = snippetEl?.textContent?.trim() ?? '';
        results.push({ title, url: href, snippet });
      }
      return results;
    });

    if (entries.length === 0) {
      ctx.warnings.push('Google result extraction found no results; falling back to raw HTML.');
      return ctx;
    }

    // Build simple HTML that to-markdown can convert, with links preserved.
    const html = entries
      .map((e) => `<h3><a href="${escapeAttr(e.url)}">${escapeHtml(e.title)}</a></h3>\n<p>${escapeHtml(e.snippet)}</p>`)
      .join('\n');

    return { ...ctx, html };
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
