import test from 'node:test';
import assert from 'node:assert/strict';

import { clearSearchBackends, registerSearchBackend, resolveSearchBackend } from '../src/search/registry.ts';
import type { SearchBackend, SearchResult } from '../src/search/interface.ts';
import { runSearch } from '../src/tools/search.ts';

class MockBackend implements SearchBackend {
  readonly name: string;
  pageNumbers: (number | undefined)[] = [];

  constructor(name: string, response: Omit<SearchResult, 'backend'>) {
    this.name = name;
    this.response = response;
  }

  private readonly response: Omit<SearchResult, 'backend'>;

  search(_page: unknown, _query: string, _sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>> {
    this.pageNumbers.push(pageNumber);
    return Promise.resolve(this.response);
  }
}

void test('runSearch includes backend name in result', async () => {
  const backend = new MockBackend('mybackend', { markdown: '# Result', url: 'https://example.com', title: 'Result', warnings: [] });

  const result = await runSearch({} as never, 'q', backend);

  assert.equal(result.backend, 'mybackend');
});

void test('runSearch returns markdown from backend', async () => {
  const backend = new MockBackend('mock', { markdown: '## Heading\nSome content', url: 'https://example.com', title: 'Title', warnings: [] });

  const result = await runSearch({} as never, 'q', backend);

  assert.equal(result.markdown, '## Heading\nSome content');
});

void test('runSearch passes pageNumber to backend', async () => {
  const backend = new MockBackend('mock', { markdown: '', url: 'https://example.com', title: 'T', warnings: [] });

  await runSearch({} as never, 'q', backend, undefined, 3);

  assert.equal(backend.pageNumbers[0], 3);
});

void test('registry selects backend by name', () => {
  clearSearchBackends();
  const backend = new MockBackend('custom', { markdown: '', url: 'https://example.com', title: 'T', warnings: [] });

  registerSearchBackend(backend);

  assert.equal(resolveSearchBackend('custom'), backend);
});

void test('registry throws for unknown backend', () => {
  clearSearchBackends();

  assert.throws(() => resolveSearchBackend('nonexistent'), /Unknown search backend/);
});
