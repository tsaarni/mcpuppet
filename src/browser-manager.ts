// Manages the shared Chromium browser instance (launch, new page, shutdown) using puppeteer-extra with the stealth plugin.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

import { config } from './config.ts';
import { cookieConsentStage } from './stages/cookie-consent.ts';
import { logger } from './util/log.ts';

const puppeteerExtra = addExtra(puppeteer as unknown as Parameters<typeof addExtra>[0]);
puppeteerExtra.use(StealthPlugin());

export class BrowserManager {
  private browser: Browser | null = null;
  private intentionalShutdown = false;

  async launch(): Promise<void> {
    if (this.browser) {
      logger.debug('Browser launch skipped: already running');
      return;
    }

    logger.info({ headless: config.headless, slowMo: config.slowMo, userDataDir: config.userDataDir }, 'Launching Chromium');

    // Remove stale lock files left behind by an unclean browser shutdown.
    for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const lockPath = path.join(config.userDataDir, lockFile);
      try {
        fs.unlinkSync(lockPath);
        logger.debug({ lockFile }, 'Removed stale browser lock file');
      } catch {
        // File doesn't exist — nothing to clean up.
      }
    }

    this.browser = await puppeteerExtra.launch({
      headless: config.headless,
      slowMo: config.slowMo,
      userDataDir: config.userDataDir,
      args: [
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    // Close any tabs restored from the previous session, keeping only one blank page.
    const existingPages = await this.browser.pages();
    if (existingPages.length > 1) {
      logger.debug({ restoredTabs: existingPages.length }, 'Closing restored tabs from previous session');
      for (const p of existingPages.slice(1)) {
        await p.close().catch(() => {});
      }
    }

    // Warm up: visit google.com to establish cookies and session state,
    // reducing the chance of CAPTCHA on the first actual search.
    await this.warmUpGoogle();

    this.intentionalShutdown = false;
    this.browser.on('disconnected', () => {
      this.browser = null;
      if (!this.intentionalShutdown) {
        logger.info('Browser was closed by user, restarting...');
        this.launch().catch((err) => logger.error({ err }, 'Failed to restart browser'));
      }
    });

    logger.info('Chromium launched');
  }

  async getPage(): Promise<Page> {
    if (!this.browser) {
      throw new Error('Browser is not launched');
    }

    const page = await this.browser.newPage();
    await page.setViewport({ width: config.viewportWidth, height: config.viewportHeight });
    logger.debug({ viewportWidth: config.viewportWidth, viewportHeight: config.viewportHeight }, 'Browser page created');
    return page;
  }

  async shutdown(): Promise<void> {
    if (!this.browser) {
      return;
    }

    this.intentionalShutdown = true;
    await this.browser.close();
    this.browser = null;
    logger.info('Chromium closed');
  }

  private async warmUpGoogle(): Promise<void> {
    if (!this.browser) {
      return;
    }

    try {
      logger.info('Warming up: visiting google.com to establish session');
      const page = (await this.browser.pages())[0] ?? await this.browser.newPage();
      await page.setViewport({ width: config.viewportWidth, height: config.viewportHeight });
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });

      // Dismiss cookie consent if shown, so it's persisted in userDataDir.
      await cookieConsentStage.execute({ page, warnings: [] });

      // Brief pause to let any tracking cookies settle.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await page.goto('about:blank').catch(() => {});
      logger.info('Warm-up complete');
    } catch (err) {
      logger.warn({ err }, 'Warm-up visit to google.com failed (non-fatal)');
    }
  }
}
