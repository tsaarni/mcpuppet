// Executes an ordered list of stages sequentially, threading StageContext through each step with logging.
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.ts';
import type { StageContext, Pipeline } from './types.ts';
import { logger } from './util/log.ts';

interface RunPipelineOptions {
  name?: string;
  logContext?: Record<string, unknown>;
}

export const runPipeline = async <T extends object = Record<string, never>>(
  ctx: StageContext<T>,
  pipeline: Pipeline<T>,
  options: RunPipelineOptions = {},
): Promise<StageContext<T>> => {
  const pipelineName = options.name ?? 'pipeline';
  let current = ctx;
  logger.debug({ pipeline: pipelineName, steps: pipeline.map((step) => step.name), ...options.logContext }, 'Starting pipeline');

  for (const stage of pipeline) {
    const started = Date.now();
    logger.debug({ pipeline: pipelineName, stage: stage.name, ...options.logContext }, 'Running stage');
    try {
      current = await stage.execute(current);
      logger.debug(
        { pipeline: pipelineName, stage: stage.name, durationMs: Date.now() - started, ...options.logContext },
        'Stage completed',
      );
    } catch (error) {
      logger.warn(
        {
          pipeline: pipelineName,
          stage: stage.name,
          durationMs: Date.now() - started,
          ...options.logContext,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        'Stage failed',
      );
      throw error;
    }
  }

  logger.debug({ pipeline: pipelineName, ...options.logContext }, 'Pipeline completed');

  if (config.sessionDebugDir && current.sessionId) {
    const sessionDir = path.join(config.sessionDebugDir, current.sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const file = path.join(sessionDir, `${Date.now()}-${pipelineName}.json`);
    // Exclude the page object — it is not serializable.
    const { page: _page, ...serializable } = current as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify(serializable, null, 2));
    logger.debug({ pipeline: pipelineName, file }, 'Wrote pipeline debug snapshot');
  }

  return current;
};
