// Manages the shared Chromium browser instance: spawns Chrome as a normal process with
// remote debugging enabled, then connects puppeteer to it. This avoids bot detection
// that triggers when puppeteer.launch() creates the browser with CDP deeply integrated.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

import { config } from './config.ts';
import { logger } from './util/log.ts';

const DEBUGGING_PORT = 9222;

export class BrowserManager {
  private browser: Browser | null = null;
  private chromeProcess: ChildProcess | null = null;
  private intentionalShutdown = false;

  async launch(): Promise<void> {
    if (this.browser) {
      logger.debug('Browser launch skipped: already running');
      return;
    }

    const executablePath = config.executablePath || 'google-chrome-stable';
    logger.info({ headless: config.headless, userDataDir: config.userDataDir, executablePath }, 'Launching Chrome');

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

    // Spawn Chrome as a normal process with remote debugging.
    const args = [
      `--remote-debugging-port=${DEBUGGING_PORT}`,
      `--user-data-dir=${path.resolve(config.userDataDir)}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--lang=en-US',
      ...(config.headless ? ['--headless=new'] : []),
      'about:blank',
    ];

    this.chromeProcess = spawn(executablePath, args, { stdio: 'ignore' });
    this.chromeProcess.on('exit', () => {
      this.chromeProcess = null;
      this.browser = null;
      if (!this.intentionalShutdown) {
        logger.info('Chrome process exited unexpectedly, restarting...');
        this.launch().catch((err) => logger.error({ err }, 'Failed to restart browser'));
      }
    });

    // Wait for Chrome's debugging port to become available.
    await this.waitForDebugPort();

    // Connect puppeteer to the running Chrome instance.
    this.browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${DEBUGGING_PORT}` });

    this.intentionalShutdown = false;
    logger.info('Connected to Chrome via remote debugging');
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
      this.browser.disconnect();
      this.browser = null;
    }

    if (this.chromeProcess) {
      this.chromeProcess.kill();
      this.chromeProcess = null;
    }

    logger.info('Chrome closed');
  }

  private async waitForDebugPort(): Promise<void> {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${DEBUGGING_PORT}/json/version`);
        if (resp.ok) return;
      } catch {
        // Not ready yet.
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Chrome debugging port did not become available within 10s');
  }
}
