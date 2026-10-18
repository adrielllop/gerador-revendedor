import test from 'node:test';
import assert from 'node:assert/strict';
import { activateLicense } from './worker-index.mjs';

const key = 'EXAMPLE-LICENSE-12345';
const device = 'device-123456';

async function fakeDatabase(record, action) {
  let current = record;
  let writes = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).includes('/proxyAndroid/keys/'));
    if (options.method === 'GET') {
      return new Response(JSON.stringify(current), { status: 200, headers: { etag: '"etag123"' } });
    }
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-Match'], '"etag123"');
    writes++;
    current = JSON.parse(options.body);
    return new Response(JSON.stringify(current), { status: 200 });
  };
  try {
    const result = await action(() => ({ current, writes }));
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('active without expiration is rejected', async () => {
  await fakeDatabase({ status:'active', boundDeviceId: device }, async state => {
    const r = await activateLicense(key, device, 'token');
    assert.equal((await r.json()).active, false);
    assert.equal(state().writes, 0);
  });
});

test('active with expired expiration is rejected', async () => {
  await fakeDatabase({ status:'active', boundDeviceId: device, expiresAt: Date.now()-1000 }, async state => {
    const r = await activateLicense(key, device, 'token');
    assert.equal((await r.json()).active, false);
    assert.equal(state().writes, 0);
  });
});

test('active works for same device and updates remaining time', async () => {
  await fakeDatabase({ status:'active', boundDeviceId: device, expiresAt: Date.now()+180_000 }, async state => {
    const r = await activateLicense(key, device, 'token');
    assert.equal((await r.json()).active, true);
    assert.equal(state().writes, 1);
    assert.ok(state().current.remainingMs > 0);
  });
});

test('active refuses another device', async () => {
  await fakeDatabase({ status:'active', boundDeviceId: device, expiresAt: Date.now()+180_000 }, async state => {
    const r = await activateLicense(key, 'different-device', 'token');
    assert.equal((await r.json()).active, false);
    assert.equal(state().writes, 0);
  });
});

test('generated active key starts duration only on first device binding', async () => {
  const createdAt = Date.now()-3_600_000;
  const durationMs = 1_800_000;
  const generatedExpiresAt = createdAt + durationMs;
  await fakeDatabase({ status:'active', activationStarted:false, boundDeviceId:'', createdAt, durationMs, expiresAt:generatedExpiresAt, remainingMs:durationMs }, async state => {
    const r = await activateLicense(key, device, 'token');
    assert.equal((await r.json()).active, true);
    assert.equal(state().writes, 1);
    assert.equal(state().current.boundDeviceId, device);
    assert.equal(state().current.activationStarted, true);
    assert.ok(state().current.activatedAt >= createdAt);
    assert.ok(state().current.expiresAt > generatedExpiresAt);
    assert.equal(state().current.expiresAt, state().current.activatedAt + durationMs);
  });
});

test('generated pending key starts duration only on first device binding', async () => {
  const createdAt = Date.now()-3_600_000;
  const durationMs = 1_800_000;
  const generatedExpiresAt = createdAt + durationMs;
  await fakeDatabase({ status:'pending', activationStarted:false, boundDeviceId:'', createdAt, durationMs, expiresAt:generatedExpiresAt, remainingMs:durationMs }, async state => {
    const r = await activateLicense(key, device, 'token');
    assert.equal((await r.json()).active, true);
    assert.equal(state().writes, 1);
    assert.equal(state().current.status, 'active');
    assert.equal(state().current.boundDeviceId, device);
    assert.equal(state().current.activationStarted, true);
    assert.ok(state().current.expiresAt > generatedExpiresAt);
    assert.equal(state().current.expiresAt, state().current.activatedAt + durationMs);
  });
});

test('active unbound after reset accepts a new device without restarting expiration', async () => {
  const expiresAt = Date.now()+180_000;
  const activatedAt = Date.now()-60_000;
  const newDevice = 'device-reset-654321';
  await fakeDatabase({ status:'active', activationStarted:true, boundDeviceId:'', expiresAt, activatedAt, remainingMs:180_000 }, async state => {
    const r = await activateLicense(key, newDevice, 'token');
    assert.equal((await r.json()).active, true);
    assert.equal(state().writes, 1);
    assert.equal(state().current.boundDeviceId, newDevice);
    assert.equal(state().current.activatedAt, activatedAt);
    assert.equal(state().current.expiresAt, expiresAt);
    assert.ok(state().current.remainingMs <= 180_000);
    assert.ok(state().current.remainingMs > 0);
  });
});

test('pending activates once and second call does not reset activation', async () => {
  await fakeDatabase({ status:'pending', paused: false, activationStarted: false, boundDeviceId:'', remainingMs: 3600_000 }, async state => {
    const first = await activateLicense(key, device, 'token');
    assert.equal((await first.json()).active, true);
    assert.equal(state().current.status, 'active');
    const activatedAt = state().current.activatedAt;
    const expiresAt = state().current.expiresAt;
    assert.equal(state().current.boundDeviceId, device);
    const second = await activateLicense(key, device, 'token');
    assert.equal((await second.json()).active, true);
    assert.equal(state().current.activatedAt, activatedAt);
    assert.equal(state().current.expiresAt, expiresAt);
    assert.equal(state().writes, 2);
  });
});

test('uses configured Firebase database URL and path', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async url => {
    requestedUrl = String(url);
    return new Response('null', { status: 200, headers: { etag: '"etag-custom"' } });
  };
  try {
    const result = await activateLicense(key, device, 'token', 'https://firebase.example.test/', '/custom/keys/');
    assert.equal((await result.json()).active, false);
    assert.equal(requestedUrl, `https://firebase.example.test/custom/keys/${encodeURIComponent(key)}.json`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
