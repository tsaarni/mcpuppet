// Defines the SearchBackend interface and result types that all search provider implementations must satisfy.
import type { Page } from 'puppeteer';

export interface SearchResult {
  markdown: string;
  url: string;
  title: string;
  warnings: string[];
  backend: string;
}

export interface SearchBackend {
  readonly name: string;
  search(page: Page, query: string, sessionId?: string, pageNumber?: number): Promise<Omit<SearchResult, 'backend'>>;
}
