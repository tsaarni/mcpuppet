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
  viewportWidth: envNumber('VIEWPORT_WIDTH', 1280),
  viewportHeight: envNumber('VIEWPORT_HEIGHT', 800),
  maxConnections: envNumber('MAX_CONNECTIONS', 10),
  requestTimeoutMs: envNumber('REQUEST_TIMEOUT_MS', 30000),
  settleDelayMs: envNumber('SETTLE_DELAY_MS', 1000),
  maxRedirects: envNumber('MAX_REDIRECTS', 5),
  searchBackend: process.env.SEARCH_BACKEND ?? 'google',
  defaultSearchLimit: envNumber('DEFAULT_SEARCH_LIMIT', 5),
  maxSearchLimit: envNumber('MAX_SEARCH_LIMIT', 10),
  userDataDir: process.env.USER_DATA_DIR ?? './.browser-data',
  port: envNumber('PORT', 3000),
  host: process.env.HOST ?? '127.0.0.1',
} as const;
