import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../src/pipeline.ts';
import { Stage } from '../src/types.ts';
import type { StageContext } from '../src/types.ts';

void test('runPipeline executes stages in order', async () => {
  class FirstStage extends Stage {
    execute(ctx: StageContext): Promise<StageContext> {
      return Promise.resolve({ ...ctx, markdown: 'hello' });
    }
  }
  class SecondStage extends Stage {
    execute(ctx: StageContext): Promise<StageContext> {
      return Promise.resolve({ ...ctx, markdown: `${ctx.markdown} world` });
    }
  }
  const pipeline: Stage[] = [
    new FirstStage(),
    new SecondStage(),
  ];

  const result = await runPipeline({ warnings: [] }, pipeline);

  assert.equal(result.markdown, 'hello world');
});

void test('runPipeline propagates errors', async () => {
  class BoomStage extends Stage {
    execute(): never {
      throw new Error('failed');
    }
  }
  const pipeline: Stage[] = [
    new BoomStage(),
  ];

  await assert.rejects(() => runPipeline({ warnings: [] }, pipeline), {
    message: 'failed',
  });
});
