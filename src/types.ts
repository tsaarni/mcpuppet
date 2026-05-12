// Core type definitions: StageContext (shared state passed between stages) and the Stage/Pipeline interfaces.
import type { Page } from 'puppeteer';

export interface BaseFilterContext {
  url?: string;
  html?: string;
  markdown?: string;
  title?: string;
  page?: Page;
  warnings: string[];
  redirectCount?: number;
  sessionId?: string;
}

export type StageContext<T extends object = {}> = BaseFilterContext & T;

export interface Stage<T extends object = {}> {
  name: string;
  execute(ctx: StageContext<T>): Promise<StageContext<T>>;
}

export type Pipeline<T extends object = {}> = Stage<T>[];
