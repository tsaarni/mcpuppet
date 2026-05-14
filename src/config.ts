// Reads all runtime configuration from environment variables and exports a single typed config object.
const envNumber = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return process.env[name] && !Number.isNaN(parsed) ? parsed : fallback;
};

const envBoolean = (name: string, fallback: boolean): boolean =>
  process.env[name] ? process.env[name].toLowerCase() === 'true' : fallback;

export const config = {
  headless: envBoolean('MCPUPPET_HEADLESS', false),
  slowMo: envNumber('MCPUPPET_SLOW_MO', 0),
  maxConnections: envNumber('MCPUPPET_MAX_CONNECTIONS', 10),
  requestTimeoutMs: envNumber('MCPUPPET_REQUEST_TIMEOUT_MS', 30000),
  settleDelayMs: envNumber('MCPUPPET_SETTLE_DELAY_MS', 1000),
  maxRedirects: envNumber('MCPUPPET_MAX_REDIRECTS', 5),
  searchBackend: process.env.MCPUPPET_SEARCH_BACKEND ?? 'google',
  sessionDebugDir: process.env.MCPUPPET_SESSION_DEBUG_DIR ?? '',
  executablePath: process.env.MCPUPPET_EXECUTABLE_PATH ?? '',  // If unset, Puppeteer's bundled browser is used.
  userDataDir: process.env.MCPUPPET_USER_DATA_DIR ?? './.browser-data',
  port: envNumber('MCPUPPET_PORT', 5420),
  host: process.env.MCPUPPET_HOST ?? '127.0.0.1',
  authToken: process.env.MCPUPPET_AUTH_TOKEN ?? '',
} as const;
