// Manages the shared Chromium browser instance launched via puppeteer.launch().
// Bot detection is avoided by stripping the automation flags that puppeteer injects
// by default (--enable-automation, --disable-extensions, etc.) and adding
// --disable-blink-features=AutomationControlled to suppress navigator.webdriver.
import fs from 'node:fs';
import path from 'node:path';

import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

import { config } from './config.ts';
import { logger } from './util/log.ts';

// Puppeteer default args that expose the browser as an automation tool and
// are detectable by bot-detection systems.
const IGNORED_DEFAULT_ARGS = [
  '--enable-automation',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-component-extensions-with-background-pages',
];

export class BrowserManager {
  private browser: Browser | null = null;
  private intentionalShutdown = false;
  private disconnectListeners: Array<() => void> = [];

  /** Register a listener called on unexpected browser disconnect (before relaunch). */
  onBrowserDisconnect(listener: () => void): void {
    this.disconnectListeners.push(listener);
  }

  async launch(): Promise<void> {
    if (this.browser) {
      logger.debug('Browser launch skipped: already running');
      return;
    }

    const executablePath = config.executablePath || undefined;
    logger.info({ headless: config.headless, userDataDir: config.userDataDir, executablePath }, 'Launching Chrome');

    // Remove lock files left by a previous unclean shutdown so Chrome doesn't
    // refuse to start or attach to a stale instance.
    for (const file of fs.readdirSync(config.userDataDir).filter(f => f.startsWith('Singleton'))) {
      try { fs.unlinkSync(path.join(config.userDataDir, file)); } catch {}
    }

    // Remove session restore data so Chrome doesn't reopen tabs from a
    // previous session (happens when Chrome was killed without graceful shutdown).
    const sessionsDir = path.join(config.userDataDir, 'Default', 'Sessions');
    try { fs.rmSync(sessionsDir, { recursive: true }); } catch {}

    this.browser = await puppeteer.launch({
      headless: config.headless,
      executablePath,
      userDataDir: config.userDataDir,
      defaultViewport: null,
      ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--noerrdialogs',
        '--disable-infobars',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--lang=en-US',
      ],
    });

    this.intentionalShutdown = false;

    this.browser.on('disconnected', () => {
      this.browser = null;
      if (!this.intentionalShutdown) {
        logger.info('Chrome disconnected unexpectedly, restarting...');
        for (const listener of this.disconnectListeners) listener();
        this.launch().catch((err) => logger.error({ err }, 'Failed to restart browser'));
      }
    });

    logger.info('Chrome launched');
  }

  async getPage(): Promise<Page> {
    if (!this.browser) {
      throw new Error('Browser is not launched');
    }

    const page = await this.browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    logger.debug('Browser page created');
    return page;
  }

  async shutdown(): Promise<void> {
    this.intentionalShutdown = true;

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    logger.info('Chrome closed');
  }
}
