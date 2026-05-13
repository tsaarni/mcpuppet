// Global registry for search backend plugins; backends are registered by name and resolved at request time.
import type { SearchBackend } from './interface.ts';
import { logger } from '../util/log.ts';

const registry = new Map<string, SearchBackend>();

export function registerSearchBackend(backend: SearchBackend): void {
  registry.set(backend.name, backend);
  logger.info({ backend: backend.name, registeredCount: registry.size }, 'Registered search backend');
}

export function resolveSearchBackend(name: string): SearchBackend {
  const backend = registry.get(name);
  if (!backend) {
    logger.warn({ backend: name, registeredBackends: Array.from(registry.keys()) }, 'Unknown search backend requested');
    throw new Error(`Unknown search backend: ${name}`);
  }
  logger.debug({ backend: name }, 'Resolved search backend');
  return backend;
}

export function clearSearchBackends(): void {
  registry.clear();
  logger.debug('Cleared search backend registry');
}
