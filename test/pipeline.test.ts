import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../src/pipeline.ts';
import type { Stage } from '../src/types.ts';

test('runPipeline executes stages in order', async () => {
  const pipeline: Stage[] = [
    {
      name: 'first',
      async execute(ctx) {
        return { ...ctx, markdown: 'hello' };
      },
    },
    {
      name: 'second',
      async execute(ctx) {
        return { ...ctx, markdown: `${ctx.markdown} world` };
      },
    },
  ];

  const result = await runPipeline({ warnings: [] }, pipeline);

  assert.equal(result.markdown, 'hello world');
});

test('runPipeline propagates errors', async () => {
  const pipeline: Stage[] = [
    {
      name: 'boom',
      async execute() {
        throw new Error('failed');
      },
    },
  ];

  await assert.rejects(() => runPipeline({ warnings: [] }, pipeline), {
    message: 'failed',
  });
});
