// Maps MCP session IDs to dedicated browser pages, enforcing the max-connections limit and cleaning up on disconnect.
import type { Page } from 'puppeteer';

import { config } from './config.ts';
import { BrowserManager } from './browser-manager.ts';
import { logger } from './util/log.ts';
import { Mutex, withTimeout, type MutexInterface } from 'async-mutex';

export interface ConnectionState {
  page: Page | null;
  pagePromise: Promise<Page> | null;
  createdAt: Date;
  /** Serializes concurrent page access within a single connection. */
  mutex: MutexInterface;
  /** Set when the browser disconnects; the page reference is dead. */
  invalidated: boolean;
}

export class ConnectionManager {
  private readonly connections = new Map<string, ConnectionState>();
  private readonly browserManager: BrowserManager;

  constructor(browserManager: BrowserManager) {
    this.browserManager = browserManager;
    this.browserManager.onBrowserDisconnect(() => this.invalidateAll());
  }

  /** Mark all connection states as invalidated (browser crashed). */
  private invalidateAll(): void {
    for (const state of this.connections.values()) {
      state.page = null;
      state.invalidated = true;
    }
    logger.info({ connections: this.connections.size }, 'All connections invalidated due to browser disconnect');
  }

  async getOrCreate(connectionId: string): Promise<ConnectionState> {
    let state = this.connections.get(connectionId);

    if (!state) {
      if (this.connections.size >= config.maxConnections) {
        logger.warn({ connectionId, currentConnections: this.connections.size, maxConnections: config.maxConnections }, 'Connection rejected: max connections reached');
        throw new Error(`Maximum connections reached (${config.maxConnections})`);
      }

      state = { page: null, pagePromise: null, createdAt: new Date(), mutex: withTimeout(new Mutex(), config.requestTimeoutMs + config.settleDelayMs), invalidated: false };
      this.connections.set(connectionId, state);
      logger.debug({ connectionId, currentConnections: this.connections.size }, 'Connection state created');
    }

    if (state.invalidated) {
      state.invalidated = false;
      throw new Error('Browser restarted, please retry');
    }

    if (!state.page) {
      if (!state.pagePromise) {
        logger.debug({ connectionId }, 'Creating browser page for connection');
        state.pagePromise = this.browserManager.getPage().then(
          (page) => {
            state.page = page;
            state.pagePromise = null;
            logger.debug({ connectionId }, 'Browser page created');
            return page;
          },
          (err) => {
            this.connections.delete(connectionId);
            logger.warn(
              { connectionId, errorMessage: err instanceof Error ? err.message : String(err) },
              'Browser page creation failed',
            );
            throw err;
          },
        );
      }
      await state.pagePromise;

      // onDisconnect removed this connection while the page was being created.
      if (!this.connections.has(connectionId)) {
        throw new Error('Connection disconnected during page creation');
      }
    }

    return state;
  }

  async onDisconnect(connectionId: string): Promise<void> {
    const state = this.connections.get(connectionId);
    if (!state) {
      logger.debug({ connectionId }, 'Disconnect for unknown connection ignored');
      return;
    }

    // Delete synchronously so any concurrent getOrCreate detects the disconnect.
    this.connections.delete(connectionId);
    logger.debug({ connectionId, currentConnections: this.connections.size }, 'Connection removed');

    if (state.pagePromise) {
      // Wait for in-flight page creation so we can close it once created.
      try {
        await state.pagePromise;
      } catch {
        // Page creation failed; nothing to close.
      }
    }

    if (state.page) {
      await state.page.close();
      logger.debug({ connectionId }, 'Connection page closed');
    }
  }

  get size(): number {
    return this.connections.size;
  }
}
