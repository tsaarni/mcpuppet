// Implements the search tool: delegates to a search backend, clamps the result limit, and post-processes
// results through sanitization and URL policy filters.
import type { Page } from 'puppeteer';

import { config } from '../config.ts';
import { sanitizeSearchResultsFilter, searchResultUrlPolicyFilter, type SearchFilterState } from '../filters/search-results.ts';
import { runPipeline } from '../pipeline.ts';
import type { SearchBackend, SearchBackendResult } from '../search/interface.ts';
import { logger } from '../util/log.ts';

const clampLimit = (limit: number): number => {
  if (limit < 1) {
    return 1;
  }

  if (limit > config.maxSearchLimit) {
    return config.maxSearchLimit;
  }

  return limit;
};

export const runSearch = async (
  page: Page,
  query: string,
  limit: number | undefined,
  backend: SearchBackend,
): Promise<SearchBackendResult> => {
  const effectiveLimit = clampLimit(limit ?? config.defaultSearchLimit);
  const started = Date.now();
  logger.info({ backend: backend.name, queryLength: query.length, requestedLimit: limit, effectiveLimit }, 'Running search');
  const raw = await backend.search(page, query, effectiveLimit);
  const postProcessed = await runPipeline<SearchFilterState>(
    { warnings: [...raw.warnings], searchResults: raw.results },
    [sanitizeSearchResultsFilter, searchResultUrlPolicyFilter],
    { name: 'search-result-post-process', logContext: { backend: backend.name, effectiveLimit } },
  );
  const result: SearchBackendResult = { results: postProcessed.searchResults, warnings: postProcessed.warnings, backend: backend.name };

  logger.info(
    { backend: backend.name, durationMs: Date.now() - started, rawCount: raw.results.length, returnedCount: result.results.length },
    'Search completed',
  );

  if (result.results.length === 0 && result.warnings.length === 0) {
    return { ...result, warnings: ['Search returned no results.'] };
  }

  return result;
};
