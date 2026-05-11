// Executes an ordered list of filters sequentially, threading FilterContext through each step with logging.
import type { FilterContext, Pipeline } from './types.ts';
import { logger } from './util/log.ts';

interface RunPipelineOptions {
  name?: string;
  logContext?: Record<string, unknown>;
}

export const runPipeline = async <T extends object = Record<string, never>>(
  ctx: FilterContext<T>,
  pipeline: Pipeline<T>,
  options: RunPipelineOptions = {},
): Promise<FilterContext<T>> => {
  const pipelineName = options.name ?? 'pipeline';
  let current = ctx;
  logger.debug({ pipeline: pipelineName, steps: pipeline.map((step) => step.name), ...options.logContext }, 'Starting pipeline');

  for (const filter of pipeline) {
    const started = Date.now();
    logger.debug({ pipeline: pipelineName, filter: filter.name, ...options.logContext }, 'Running filter');
    try {
      current = await filter.execute(current);
      logger.debug(
        { pipeline: pipelineName, filter: filter.name, durationMs: Date.now() - started, ...options.logContext },
        'Filter completed',
      );
    } catch (error) {
      logger.warn(
        {
          pipeline: pipelineName,
          filter: filter.name,
          durationMs: Date.now() - started,
          ...options.logContext,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        'Filter failed',
      );
      throw error;
    }
  }

  logger.debug({ pipeline: pipelineName, ...options.logContext }, 'Pipeline completed');
  return current;
};
