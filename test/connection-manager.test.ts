import test from 'node:test';
import assert from 'node:assert/strict';

import { ConnectionManager } from '../src/connection-manager.ts';
import type { BrowserManager } from '../src/browser-manager.ts';
import { config } from '../src/config.ts';

class MockBrowserManager {
  pagesCreated = 0;
  pagesClosed = 0;

  async getPage() {
    this.pagesCreated++;
    return { close: async () => { this.pagesClosed++; } };
  }
}

const makeCM = () => {
  const bm = new MockBrowserManager();
  const cm = new ConnectionManager(bm as unknown as BrowserManager);
  return { bm, cm };
};

test('ConnectionManager creates page on first access', async () => {
  const { bm, cm } = makeCM();
  const state = await cm.getOrCreate('s1');
  assert.ok(state.page);
  assert.equal(bm.pagesCreated, 1);
});

test('ConnectionManager reuses connection within same session', async () => {
  const { bm, cm } = makeCM();
  await cm.getOrCreate('s1');
  await cm.getOrCreate('s1');
  assert.equal(bm.pagesCreated, 1);
  assert.equal(cm.size, 1);
});

test('ConnectionManager closes page on disconnect', async () => {
  const { bm, cm } = makeCM();
  await cm.getOrCreate('s1');
  assert.equal(cm.size, 1);

  await cm.onDisconnect('s1');
  assert.equal(cm.size, 0);
  assert.equal(bm.pagesClosed, 1);
});

test('ConnectionManager onDisconnect is idempotent for unknown session', async () => {
  const { cm } = makeCM();
  await assert.doesNotReject(() => cm.onDisconnect('unknown'));
});

test('ConnectionManager throws when max connections reached', async () => {
  const { cm } = makeCM();

  for (let i = 0; i < config.maxConnections; i++) {
    await cm.getOrCreate(`s${i}`);
  }

  await assert.rejects(() => cm.getOrCreate('overflow'), /Maximum connections reached/);
});

test('ConnectionManager concurrent getOrCreate for same session creates only one page', async () => {
  const { bm, cm } = makeCM();
  const [s1, s2] = await Promise.all([cm.getOrCreate('s1'), cm.getOrCreate('s1')]);
  assert.equal(bm.pagesCreated, 1);
  assert.strictEqual(s1.page, s2.page);
});

test('ConnectionManager retries page creation after failure', async () => {
  const bm = new MockBrowserManager();
  let calls = 0;
  bm.getPage = async () => {
    calls++;
    if (calls === 1) throw new Error('browser unavailable');
    bm.pagesCreated++;
    return { close: async () => { bm.pagesClosed++; } };
  };
  const cm = new ConnectionManager(bm as unknown as BrowserManager);

  await assert.rejects(() => cm.getOrCreate('s1'), /browser unavailable/);
  const state = await cm.getOrCreate('s1');
  assert.ok(state.page);
  assert.equal(calls, 2);
});

test('ConnectionManager closes page when disconnect arrives during in-flight page creation', async () => {
  let resolveGetPage!: (page: { close: () => Promise<void> }) => void;
  const bm = {
    pagesCreated: 0,
    pagesClosed: 0,
    getPage: async () => {
      bm.pagesCreated++;
      return new Promise<{ close: () => Promise<void> }>((resolve) => {
        resolveGetPage = resolve;
      });
    },
  };

  const cm = new ConnectionManager(bm as unknown as BrowserManager);
  const getOrCreatePromise = cm.getOrCreate('s1');

  // Disconnect while page creation is in-flight.
  const disconnectPromise = cm.onDisconnect('s1');

  // Resolve the page now; onDisconnect must close it.
  resolveGetPage({ close: async () => { bm.pagesClosed++; } });

  await assert.rejects(() => getOrCreatePromise, /disconnected/);
  await disconnectPromise;

  assert.equal(bm.pagesCreated, 1);
  assert.equal(bm.pagesClosed, 1);
  assert.equal(cm.size, 0);
});


test('ConnectionManager tracks multiple independent sessions', async () => {
  const { bm, cm } = makeCM();
  await cm.getOrCreate('s1');
  await cm.getOrCreate('s2');
  assert.equal(cm.size, 2);
  assert.equal(bm.pagesCreated, 2);

  await cm.onDisconnect('s1');
  assert.equal(cm.size, 1);
  assert.equal(bm.pagesClosed, 1);
});
