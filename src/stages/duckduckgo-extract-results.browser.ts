// Browser-side script that extracts DuckDuckGo HTML search results from the DOM.

import type { SearchEntry } from './google-extract-results.browser.ts';

export function extractDuckDuckGoResults(): SearchEntry[] {
  const results: SearchEntry[] = [];
  const containers: NodeListOf<Element> = document.querySelectorAll('.result');
  for (const container of containers) {
    const link: HTMLAnchorElement | null = container.querySelector('.result__title a');
    if (!link) continue;
    let href: string = link.href;
    try {
      const parsed = new URL(href);
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) href = uddg;
    } catch { /* use href as-is */ }
    if (href.startsWith('/') || href.includes('duckduckgo.com/')) continue;
    const title: string = link.textContent?.trim() ?? '';
    const snippetEl: Element | null = container.querySelector('.result__snippet');
    const snippet: string = snippetEl?.textContent?.trim() ?? '';
    results.push({ title, url: href, snippet });
  }
  return results;
}
