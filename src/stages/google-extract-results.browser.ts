// Browser-side script that extracts Google search results from the DOM.

export interface SearchEntry {
  title: string;
  url: string;
  snippet: string;
}

export function extractGoogleResults(): SearchEntry[] {
  const results: SearchEntry[] = [];
  // Google wraps each organic result in a div.g or a [data-snc] container with an <a> containing <h3>.
  const containers: NodeListOf<Element> = document.querySelectorAll('div.g, div[data-snc]');

  for (const container of containers) {
    const link: Element | null = container.querySelector('a[href]');
    const heading: Element | null = container.querySelector('h3');
    if (!link || !heading) continue;

    const href: string = link.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || href.startsWith('/search')) continue;

    const title: string = heading.textContent?.trim() ?? '';
    // Snippet is typically in a div with class containing "VwiC3b" or a span inside the result.
    const snippetEl: Element | null = container.querySelector('[data-sncf] span, .VwiC3b, [style*="-webkit-line-clamp"]');
    const snippet: string = snippetEl?.textContent?.trim() ?? '';

    results.push({ title, url: href, snippet });
  }

  return results;
}
