'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMarketCatalog, defaultCacheFile, compare } = require('../src/market/catalog.js');
const { listUrl, manifestUrl } = require('../src/market/hub-client.js');

function tempCache(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-market-catalog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'cache.json');
}

const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) });
const SHA = 'a'.repeat(40);

function model(id, changes = {}) {
  return {
    id, sha: SHA, tags: ['microduck-policy', 'license:apache-2.0'],
    siblings: [{ rfilename: 'policy.onnx' }, { rfilename: 'manifest.json' }, { rfilename: 'media/preview.mp4' }],
    likes: 0, downloads: 0, lastModified: '2026-08-01T00:00:00.000Z', ...changes,
  };
}

const episodic = { model_api: 1, obs_len: 61, action_len: 14, kind: 'episodic', duration_s: 3, command: { idle: [0, 0, 0] }, robot: { model: 'microduck', control_hz: 50 } };
const opaque = { model_api: 1, obs_len: 61, action_len: 14, kind: 'perpetual', robot: { model: 'microduck', control_hz: 50 } };

function catalogOver(t, models, manifests) {
  const routes = { [listUrl(200)]: ok(models) };
  for (const [repo, manifest] of Object.entries(manifests)) routes[manifestUrl(repo, SHA)] = ok(manifest);
  return createMarketCatalog({
    cacheFile: tempCache(t),
    fetchImpl: async (url) => {
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route;
    },
  });
}

test('usable entries come first and preview media is routed through the proxy', async (t) => {
  const catalog = catalogOver(t,
    [model('a/opaque', { likes: 99 }), model('b/usable', { likes: 1 })],
    { 'a/opaque': opaque, 'b/usable': episodic });
  const result = await catalog.list();
  assert.deepEqual(result.entries.map((entry) => entry.repo), ['b/usable', 'a/opaque'],
    'a ready entry outranks a more-liked one it cannot drive');
  assert.equal(result.counts.ready, 1);
  assert.equal(result.counts.manual, 1);
  assert.equal(result.entries[0].mediaUrl, `pet-market://media/b/usable/${SHA}/media/preview.mp4`);
  assert.equal(result.stale, false);
});

test('within a band the Hub signals order the entries', () => {
  const band = (changes) => ({ status: 'ready', likes: 0, downloads: 0, updatedAt: null, ...changes });
  assert.ok(compare(band({ likes: 5 }), band({ likes: 1 })) < 0);
  assert.ok(compare(band({ downloads: 9 }), band({ downloads: 2 })) < 0);
  assert.ok(compare(band({ updatedAt: '2026-09-01' }), band({ updatedAt: '2026-01-01' })) < 0);
  assert.ok(compare(band({ likes: 0 }), { status: 'manual', likes: 99, downloads: 99, updatedAt: '2030-01-01' }) < 0);
});

test('an entry with no preview still lists, with no media URL', async (t) => {
  const catalog = catalogOver(t, [model('a/bare', { siblings: [{ rfilename: 'policy.onnx' }] })], {});
  const [entry] = (await catalog.list()).entries;
  assert.equal(entry.mediaUrl, null);
  assert.equal(entry.posterUrl, null);
  assert.equal(entry.status, 'unverifiable');
});

test('the cache lives under the app directory, not the repository', () => {
  const file = defaultCacheFile('/home/someone');
  assert.equal(file, path.join('/home/someone', '.duck-on-desk', 'market', 'hub-cache.json'));
});
