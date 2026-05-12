// Reads all runtime configuration from environment variables and exports a single typed config object.
const envNumber = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
};

const envBoolean = (name: string, fallback: boolean): boolean => {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
};

export const config = {
  headless: envBoolean('HEADLESS', false),
  slowMo: envNumber('SLOW_MO', 0),
  maxConnections: envNumber('MAX_CONNECTIONS', 10),
  requestTimeoutMs: envNumber('REQUEST_TIMEOUT_MS', 30000),
  settleDelayMs: envNumber('SETTLE_DELAY_MS', 1000),
  maxRedirects: envNumber('MAX_REDIRECTS', 5),
  searchBackend: process.env.SEARCH_BACKEND ?? 'google',
  sessionDebugDir: process.env.SESSION_DEBUG_DIR ?? '',
  executablePath: process.env.EXECUTABLE_PATH ?? '',  // If unset, Puppeteer's bundled browser is used.
  userDataDir: process.env.USER_DATA_DIR ?? './.browser-data',
  port: envNumber('PORT', 3000),
  host: process.env.HOST ?? '127.0.0.1',
} as const;
