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

function formatLocalTimestamp(date: Date): string {
  const pad2 = (value: number) => value.toString().padStart(2, '0');
  const pad3 = (value: number) => value.toString().padStart(3, '0');

  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
}

export async function runPipeline<T extends object = Record<string, never>>(
  ctx: StageContext<T>,
  pipeline: Pipeline<T>,
  options: RunPipelineOptions = {},
): Promise<StageContext<T>> {
  const pipelineName = options.name ?? 'pipeline';

  // Assign a human-readable timestamp with msec precision at pipeline creation.
  const timestamp = ctx.timestamp ?? formatLocalTimestamp(new Date());
  let current = { ...ctx, timestamp } as StageContext<T>;

  const stageSnapshots: { stage: string; html?: string }[] = [];

  logger.debug({ pipeline: pipelineName, timestamp, steps: pipeline.map((step) => step.name), ...options.logContext }, 'Starting pipeline');

  for (const stage of pipeline) {
    const started = Date.now();
    logger.debug({ pipeline: pipelineName, stage: stage.name, ...options.logContext }, 'Running stage');
    try {
      current = await stage.execute(current);
      if (config.sessionDebugDir) {
        stageSnapshots.push({ stage: stage.name, html: current.html });
      }
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { page, ...serializable } = current as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify({ ...serializable, stageSnapshots }, null, 2));
    logger.debug({ pipeline: pipelineName, timestamp, file }, 'Wrote pipeline debug snapshot');
  }

  return current;
}
