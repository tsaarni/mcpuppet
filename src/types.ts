// Core type definitions: StageContext (shared state passed between stages) and the Stage/Pipeline interfaces.
import type { Page } from 'puppeteer';

export type ParsedDocument = Document & { toString(): string };

export interface BaseFilterContext {
  url?: string;
  html?: string;
  /** Pre-parsed DOM document, passed between stages to avoid redundant parsing. */
  document?: ParsedDocument;
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

export abstract class Stage<T extends object = object> {
  /** Stage name for logging. Derived from class name, override if needed. */
  get name(): string {
    return this.constructor.name
      .replaceAll(/Stage$/g, '')
      .replaceAll(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
  }

  abstract execute(ctx: StageContext<T>): StageContext<T> | Promise<StageContext<T>>;
}

export type Pipeline<T extends object = object> = Stage<T>[];
