'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHubClient, listUrl, manifestUrl, mapLimit, MAX_MANIFEST_BYTES } = require('../src/market/hub-client.js');

function tempCache(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-market-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'cache.json');
}

const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) });
const missing = { ok: false, status: 404, headers: new Headers(), text: async () => 'not found' };

function model(id, sha, files = ['policy.onnx', 'manifest.json']) {
  return { id, sha, siblings: files.map((rfilename) => ({ rfilename })), tags: [], likes: 0, downloads: 0 };
}

// A fetch double that records every URL it is asked for.
function stub(routes) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      const route = routes[url];
      if (route === undefined) throw new Error(`unexpected fetch: ${url}`);
      return typeof route === 'function' ? route() : route;
    },
  };
}

test('one listing request carries the revision and file list for every repository', async (t) => {
  const sha = 'a'.repeat(40);
  const { fetchImpl, calls } = stub({
    [listUrl(200)]: ok([model('a/one', sha)]),
    [manifestUrl('a/one', sha)]: ok({ model_api: 1, name: 'one' }),
  });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl });
  const result = await client.load();
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.manifests[`a/one@${sha}`], { model_api: 1, name: 'one' });
  assert.equal(result.stale, false);
  assert.equal(calls.length, 2, 'one listing call plus one manifest call');
});

test('a repository with no manifest.json costs no request', async (t) => {
  const sha = 'b'.repeat(40);
  const { fetchImpl, calls } = stub({ [listUrl(200)]: ok([model('a/bare', sha, ['policy.onnx'])]) });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl });
  const result = await client.load();
  assert.deepEqual(Object.keys(result.manifests), []);
  assert.deepEqual(calls, [listUrl(200)]);
});

test('a 404 manifest is recorded as absent, not as a failure', async (t) => {
  const sha = 'c'.repeat(40);
  const { fetchImpl } = stub({ [listUrl(200)]: ok([model('a/gone', sha)]), [manifestUrl('a/gone', sha)]: missing });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl });
  const result = await client.load();
  assert.equal(result.manifests[`a/gone@${sha}`], null);
});

test('one unreadable manifest does not empty the listing', async (t) => {
  const sha = 'd'.repeat(40);
  const { fetchImpl } = stub({
    [listUrl(200)]: ok([model('a/bad', sha), model('a/good', sha)]),
    [manifestUrl('a/bad', sha)]: () => { throw new Error('connection reset'); },
    [manifestUrl('a/good', sha)]: ok({ model_api: 1 }),
  });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl });
  const result = await client.load();
  assert.equal(result.models.length, 2);
  assert.equal(result.manifests[`a/good@${sha}`].model_api, 1);
  assert.equal(`a/bad@${sha}` in result.manifests, false);
});

test('a manifest is reused while the repository points at the same revision', async (t) => {
  const sha = 'e'.repeat(40);
  const next = 'f'.repeat(40);
  let clock = 1000;
  let listing = [model('a/one', sha)];
  let manifestCalls = 0;
  const fetchImpl = async (url) => {
    if (url === listUrl(200)) return ok(listing);
    manifestCalls += 1;
    return ok({ model_api: 1, revision: url });
  };
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl, now: () => clock, ttlMs: 100 });
  await client.load();
  assert.equal(manifestCalls, 1);

  clock += 500; // past the TTL, but the revision has not moved
  await client.load();
  assert.equal(manifestCalls, 1, 'an unchanged revision is not re-fetched');

  clock += 500;
  listing = [model('a/one', next)];
  const moved = await client.load();
  assert.equal(manifestCalls, 2, 'a new revision is fetched');
  assert.equal(`a/one@${next}` in moved.manifests, true);
  assert.equal(`a/one@${sha}` in moved.manifests, false, 'the superseded revision is dropped');
});

test('a fresh cache answers without touching the network', async (t) => {
  const sha = '1'.repeat(40);
  let clock = 5000;
  const { fetchImpl, calls } = stub({
    [listUrl(200)]: ok([model('a/one', sha)]),
    [manifestUrl('a/one', sha)]: ok({ model_api: 1 }),
  });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl, now: () => clock, ttlMs: 10000 });
  await client.load();
  const before = calls.length;
  await client.load();
  assert.equal(calls.length, before, 'served from memory inside the TTL');
  clock += 20000;
  await client.load();
  assert.ok(calls.length > before, 'refreshed once the TTL expires');
});

test('an offline refresh serves the cache and says it is stale', async (t) => {
  const sha = '2'.repeat(40);
  const file = tempCache(t);
  let online = true;
  const fetchImpl = async (url) => {
    if (!online) throw new Error('getaddrinfo ENOTFOUND huggingface.co');
    return url === listUrl(200) ? ok([model('a/one', sha)]) : ok({ model_api: 1 });
  };
  const client = createHubClient({ cacheFile: file, fetchImpl, ttlMs: 0 });
  await client.load();
  online = false;
  const result = await client.load();
  assert.equal(result.stale, true);
  assert.match(result.error, /ENOTFOUND/);
  assert.equal(result.models.length, 1);
});

test('with no cache at all, an offline load reports the failure', async (t) => {
  const client = createHubClient({
    cacheFile: tempCache(t),
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await assert.rejects(() => client.load(), /offline/);
});

test('the cache survives a restart and is keyed by revision', async (t) => {
  const sha = '3'.repeat(40);
  const file = tempCache(t);
  const { fetchImpl, calls } = stub({
    [listUrl(200)]: ok([model('a/one', sha)]),
    [manifestUrl('a/one', sha)]: ok({ model_api: 1, name: 'kept' }),
  });
  await createHubClient({ cacheFile: file, fetchImpl, ttlMs: 10000, now: () => 1 }).load();
  const restarted = createHubClient({ cacheFile: file, fetchImpl, ttlMs: 10000, now: () => 2 });
  const result = await restarted.load();
  assert.equal(result.manifests[`a/one@${sha}`].name, 'kept');
  assert.equal(calls.length, 2, 'the restarted client made no further requests');
  assert.equal(restarted.manifestFor('a/one', sha).name, 'kept');
});

test('a corrupt or foreign cache file is ignored rather than thrown', async (t) => {
  const file = tempCache(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sha = '4'.repeat(40);
  const { fetchImpl } = stub({ [listUrl(200)]: ok([model('a/one', sha, ['policy.onnx'])]) });
  for (const contents of ['{not json', JSON.stringify({ version: 99, models: [] }), JSON.stringify({ version: 1 })]) {
    fs.writeFileSync(file, contents);
    const client = createHubClient({ cacheFile: file, fetchImpl });
    const result = await client.load();
    assert.equal(result.models.length, 1);
  }
});

test('an oversized body is refused instead of buffered', async (t) => {
  const sha = '5'.repeat(40);
  const huge = 'x'.repeat(MAX_MANIFEST_BYTES + 1);
  const { fetchImpl } = stub({
    [listUrl(200)]: ok([model('a/one', sha)]),
    [manifestUrl('a/one', sha)]: { ok: true, status: 200, headers: new Headers(), text: async () => huge },
  });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl });
  const result = await client.load();
  assert.equal(`a/one@${sha}` in result.manifests, false);
});

test('a listing that is not an array is refused', async (t) => {
  const { fetchImpl } = stub({ [listUrl(200)]: ok({ error: 'rate limited' }) });
  const client = createHubClient({ cacheFile: tempCache(t), fetchImpl });
  await assert.rejects(() => client.load(), /Unexpected listing payload/);
});

test('mapLimit keeps the requested number of workers in flight and preserves order', async () => {
  let live = 0;
  let peak = 0;
  const items = Array.from({ length: 12 }, (_, index) => index);
  const results = await mapLimit(items, 3, async (item) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((resolve) => setTimeout(resolve, 1));
    live -= 1;
    return item * 2;
  });
  assert.equal(peak, 3);
  assert.deepEqual(results, items.map((item) => item * 2));
});
