import test from 'node:test';
import assert from 'node:assert/strict';

import { runPipeline } from '../src/pipeline.ts';
import type { Filter } from '../src/types.ts';

test('runPipeline executes filters in order', async () => {
  const pipeline: Filter[] = [
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
  const pipeline: Filter[] = [
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
