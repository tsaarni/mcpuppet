import test from 'node:test';
import assert from 'node:assert/strict';

import { detectChromeExecutable } from '../src/platform.ts';

void test('detectChromeExecutable returns a string', () => {
  const result = detectChromeExecutable();
  assert.equal(typeof result, 'string');
});
