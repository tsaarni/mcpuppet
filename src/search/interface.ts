// Defines the SearchBackend interface and result types that all search provider implementations must satisfy.
import type { Page } from 'puppeteer';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface SearchBackendResult {
  results: SearchResult[];
  warnings: string[];
  backend: string;
}

export interface SearchBackend {
  readonly name: string;
  search(page: Page, query: string, limit: number): Promise<Omit<SearchBackendResult, 'backend'>>;
}
