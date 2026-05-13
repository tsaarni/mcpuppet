import test from 'node:test';
import assert from 'node:assert/strict';

import { Hono } from 'hono';

// Builds a minimal app with the same auth middleware used in main.ts.
const makeApp = (authToken: string) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (authToken) {
      const auth = c.req.header('Authorization');
      if (auth !== `Bearer ${authToken}`) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    await next();
  });

  app.get('/mcp', (c) => c.text('ok'));
  return app;
};

void test('auth: allows request when no token is configured', async () => {
  const app = makeApp('');
  const res = await app.request('/mcp');
  assert.equal(res.status, 200);
});

void test('auth: allows request with correct Bearer token', async () => {
  const app = makeApp('secret');
  const res = await app.request('/mcp', { headers: { Authorization: 'Bearer secret' } });
  assert.equal(res.status, 200);
});

void test('auth: rejects request with wrong token', async () => {
  const app = makeApp('secret');
  const res = await app.request('/mcp', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(res.status, 401);
});

void test('auth: rejects request with missing Authorization header', async () => {
  const app = makeApp('secret');
  const res = await app.request('/mcp');
  assert.equal(res.status, 401);
});

void test('auth: rejects request with non-Bearer scheme', async () => {
  const app = makeApp('secret');
  const res = await app.request('/mcp', { headers: { Authorization: 'Basic secret' } });
  assert.equal(res.status, 401);
});
