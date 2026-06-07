import { existsSync } from 'node:fs';
import { platform } from 'node:os';

const CANDIDATES: Record<string, string[]> = {
  // Ubuntu 23.10+: Puppeteer's bundled Chrome fails with "No usable sandbox!"
  // due to AppArmor user namespace restrictions.
  // https://github.com/puppeteer/puppeteer/issues/12818
  // Workaround: use system installed Chrome instead of bundled Chrome.
  linux: [
    '/opt/google/chrome/chrome',
  ],
};

/**
 * Detect a system-installed Chrome/Chromium binary for the current platform.
 * Returns the first existing candidate path, or "" if none is found (which
 * causes Puppeteer to use its bundled browser).
 */
export function detectChromeExecutable(): string {
  const candidates = CANDIDATES[platform()] ?? [];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return '';
}
