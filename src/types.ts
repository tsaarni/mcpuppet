// Core type definitions: StageContext (shared state passed between stages) and the Stage/Pipeline interfaces.
import type { Page } from 'puppeteer';

export interface BaseFilterContext {
  url?: string;
  html?: string;
  /** Pre-parsed DOM document, passed between stages to avoid redundant parsing. */
  document?: unknown;
  markdown?: string;
  title?: string;
  page?: Page;
  warnings: string[];
  redirectCount?: number;
  sessionId?: string;
  /** Human-readable timestamp (msec precision) assigned at pipeline creation. */
  timestamp?: string;
  /** Deferred cleanup functions to run after the pipeline completes (e.g., disabling request interception). */
  cleanups?: (() => Promise<void>)[];
}

export type StageContext<T extends object = object> = BaseFilterContext & T;

export interface Stage<T extends object = object> {
  name: string;
  execute(ctx: StageContext<T>): Promise<StageContext<T>>;
}

export type Pipeline<T extends object = object> = Stage<T>[];
