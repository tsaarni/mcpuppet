// Core type definitions: FilterContext (shared state passed between filters) and the Filter/Pipeline interfaces.
import type { Page } from 'puppeteer';

export interface BaseFilterContext {
  url?: string;
  html?: string;
  markdown?: string;
  title?: string;
  page?: Page;
  warnings: string[];
  redirectCount?: number;
}

export type FilterContext<T extends object = {}> = BaseFilterContext & T;

export interface Filter<T extends object = {}> {
  name: string;
  execute(ctx: FilterContext<T>): Promise<FilterContext<T>>;
}

export type Pipeline<T extends object = {}> = Filter<T>[];
