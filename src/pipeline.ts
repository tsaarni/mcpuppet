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

  // Assign a human-readable timestamp with msec precision at pipeline creation.
  const now = new Date();
  const timestamp =
    ctx.timestamp ??
    now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      '-' +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0') +
      '.' +
      now.getMilliseconds().toString().padStart(3, '0');
  let current = { ...ctx, timestamp } as StageContext<T>;

  logger.debug({ pipeline: pipelineName, timestamp, steps: pipeline.map((step) => step.name), ...options.logContext }, 'Starting pipeline');

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

  logger.debug({ pipeline: pipelineName, timestamp, ...options.logContext }, 'Pipeline completed');

  if (config.sessionDebugDir && current.sessionId) {
    const sessionDir = path.join(config.sessionDebugDir, current.sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const file = path.join(sessionDir, `${timestamp}-${pipelineName}.json`);
    // Exclude the page object — it is not serializable.
    const { page: _page, ...serializable } = current as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify(serializable, null, 2));
    logger.debug({ pipeline: pipelineName, timestamp, file }, 'Wrote pipeline debug snapshot');
  }

  return current;
};
