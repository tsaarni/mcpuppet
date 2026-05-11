// Filters for post-processing search results: sanitizes text fields and enforces URL safety policy on result links.
import type { SearchResult } from '../search/interface.ts';
import type { Filter, FilterContext } from '../types.ts';
import { validateUrlPolicy } from './url-policy.ts';

export interface SearchFilterState {
  searchResults: SearchResult[];
}

const CONTROL_CHARS_RE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u180e\u200b-\u200f\u2028-\u2029\u2060-\u2064\u206a-\u206f\ufeff\ufff9-\ufffb]/g;

const sanitizeSearchText = (value: string): string =>
  value.replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim();

const appendWarning = (ctx: FilterContext<SearchFilterState>, warning: string): void => {
  ctx.warnings.push(warning);
};

export const sanitizeSearchResultsFilter: Filter<SearchFilterState> = {
  name: 'sanitize-search-results',
  async execute(ctx) {
    const sanitized: SearchResult[] = [];
    let dropped = 0;

    for (const result of ctx.searchResults) {
      const title = sanitizeSearchText(result.title);
      const snippet = sanitizeSearchText(result.snippet);

      if (!title) {
        dropped += 1;
        continue;
      }

      sanitized.push({ ...result, title, snippet });
    }

    if (dropped > 0) {
      appendWarning(ctx, `Filtered ${dropped} search result(s) with empty title after sanitization.`);
    }

    return { ...ctx, searchResults: sanitized };
  },
};

const REDIRECT_PARAMS = ['url', 'redirect', 'next', 'target', 'goto', 'return', 'q'];

const checkOpenRedirects = (parsed: URL): void => {
  for (const param of REDIRECT_PARAMS) {
    const value = parsed.searchParams.get(param);
    if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
      validateUrlPolicy(value); // throws if blocked
    }
  }
};

export const searchResultUrlPolicyFilter: Filter<SearchFilterState> = {
  name: 'search-result-url-policy',
  async execute(ctx) {
    const filtered: SearchResult[] = [];
    let dropped = 0;

    for (const result of ctx.searchResults) {
      try {
        const parsed = validateUrlPolicy(result.url);
        checkOpenRedirects(parsed);
        filtered.push({ ...result, url: parsed.toString() });
      } catch {
        dropped += 1;
      }
    }

    if (dropped > 0) {
      appendWarning(ctx, `Filtered ${dropped} search result(s) by URL safety policy.`);
    }

    return { ...ctx, searchResults: filtered };
  },
};
