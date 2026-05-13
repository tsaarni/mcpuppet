import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../src/pipeline.ts';
import type { Stage } from '../src/types.ts';

void test('runPipeline executes stages in order', async () => {
  const pipeline: Stage[] = [
    {
      name: 'first',
      execute(ctx) {
        return Promise.resolve({ ...ctx, markdown: 'hello' });
      },
    },
    {
      name: 'second',
      execute(ctx) {
        return Promise.resolve({ ...ctx, markdown: `${ctx.markdown} world` });
      },
    },
  ];

  const result = await runPipeline({ warnings: [] }, pipeline);

  assert.equal(result.markdown, 'hello world');
});

void test('runPipeline propagates errors', async () => {
  const pipeline: Stage[] = [
    {
      name: 'boom',
      execute(): never {
        throw new Error('failed');
      },
    },
  ];

  await assert.rejects(() => runPipeline({ warnings: [] }, pipeline), {
    message: 'failed',
  });
});
