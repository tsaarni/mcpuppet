// Creates and exports the shared logger instance, resolving the log level from the LOG_LEVEL environment variable.
import { consola } from 'consola';

const resolveLogLevel = (): number => {
  const value = process.env.LOG_LEVEL;
  if (!value) {
    return 3;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  const namedLevels: Record<string, number> = {
    silent: 0,
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
    verbose: 4,
  };

  return namedLevels[value.toLowerCase()] ?? 3;
};

export const logger = consola.create({
  level: resolveLogLevel(),
});
