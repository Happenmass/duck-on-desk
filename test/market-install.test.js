'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createInstaller, policyPath, defaultRoot, MIN_POLICY_BYTES } = require('../src/market/install.js');

const REPO = 'joanfox/microduck-happy-hop';
const SHA = 'c'.repeat(40);

function tempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-market-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const weights = Buffer.alloc(MIN_POLICY_BYTES + 512, 7);
const digest = crypto.createHash('sha256').update(weights).digest('hex');

// A Hub double: the tree endpoint plus the LFS-backed file.
function hub({ size = weights.length, oid = digest, body = weights, treeStatus = 200, fileStatus = 200 } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/api/models/')) {
        return {
          ok: treeStatus === 200, status: treeStatus, headers: new Headers(),
          text: async () => JSON.stringify([
            { path: 'README.md', size: 120 },
            { path: 'policy.onnx', size, lfs: oid ? { oid, size, pointerSize: 131 } : undefined },
          ]),
        };
      }
      return { ok: fileStatus === 200, status: fileStatus, headers: new Headers(), arrayBuffer: async () => body };
    },
  };
}

test('a policy is downloaded once, verified, and filed under its revision', async (t) => {
  const root = tempRoot(t);
  const { fetchImpl, calls } = hub();
  const installer = createInstaller({ root, fetchImpl });
  assert.equal(installer.isInstalled(REPO, SHA), false);

  const result = await installer.install(REPO, SHA);
  assert.equal(result.bytes, weights.length);
  assert.equal(result.sha256, digest);
  assert.equal(result.reused, false);
  assert.equal(result.file, path.join(root, 'joanfox', 'microduck-happy-hop', SHA, 'policy.onnx'));
  assert.equal(fs.readFileSync(result.file).length, weights.length);
  assert.equal(installer.isInstalled(REPO, SHA), true);

  const again = await installer.install(REPO, SHA);
  assert.equal(again.reused, true);
  assert.equal(calls.filter((url) => url.endsWith('policy.onnx')).length, 1, 'the weights are fetched once');
});

test('content that does not match the Hub digest never lands', async (t) => {
  const root = tempRoot(t);
  const tampered = Buffer.alloc(weights.length, 9);
  const installer = createInstaller({ root, fetchImpl: hub({ body: tampered }).fetchImpl });
  await assert.rejects(() => installer.install(REPO, SHA), /校验和/);
  assert.equal(fs.existsSync(policyPath(REPO, SHA, root)), false);
  assert.equal(fs.readdirSync(root).length === 0 || fs.readdirSync(path.join(root, 'joanfox', 'microduck-happy-hop', SHA)).length === 0, true,
    'no partial file is left behind');
});

test('a size that disagrees with the repository record is refused', async (t) => {
  const root = tempRoot(t);
  const installer = createInstaller({ root, fetchImpl: hub({ size: weights.length + 1 }).fetchImpl });
  await assert.rejects(() => installer.install(REPO, SHA), /体积与仓库记录不一致/);
  assert.equal(fs.existsSync(policyPath(REPO, SHA, root)), false);
});

test('an absurd declared size is refused before anything is fetched', async (t) => {
  const root = tempRoot(t);
  for (const size of [1000, 900000000]) {
    const { fetchImpl, calls } = hub({ size });
    const installer = createInstaller({ root, fetchImpl });
    await assert.rejects(() => installer.install(REPO, SHA), /体积异常/);
    assert.equal(calls.filter((url) => url.endsWith('policy.onnx')).length, 0, `size ${size}: no download attempted`);
  }
});

test('a stale file under a revision is replaced rather than served', async (t) => {
  const root = tempRoot(t);
  const target = policyPath(REPO, SHA, root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.alloc(weights.length, 3));
  const installer = createInstaller({ root, fetchImpl: hub().fetchImpl });
  const result = await installer.install(REPO, SHA);
  assert.equal(result.reused, false);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'), digest);
});

test('a repository without policy.onnx at that revision reports it plainly', async (t) => {
  const root = tempRoot(t);
  const fetchImpl = async (url) => (url.includes('/api/models/')
    ? { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify([{ path: 'README.md', size: 10 }]) }
    : { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => weights });
  await assert.rejects(() => createInstaller({ root, fetchImpl }).install(REPO, SHA), /没有 policy\.onnx/);
});

test('network failures surface instead of producing an empty file', async (t) => {
  const root = tempRoot(t);
  const notFound = createInstaller({ root, fetchImpl: hub({ fileStatus: 404 }).fetchImpl });
  await assert.rejects(() => notFound.install(REPO, SHA), /HTTP 404/);
  assert.equal(fs.existsSync(policyPath(REPO, SHA, root)), false);
  const treeDown = createInstaller({ root, fetchImpl: hub({ treeStatus: 500 }).fetchImpl });
  await assert.rejects(() => treeDown.install(REPO, SHA), /HTTP 500/);
});

test('a non-LFS file still installs, checked on size alone', async (t) => {
  const root = tempRoot(t);
  const installer = createInstaller({ root, fetchImpl: hub({ oid: null }).fetchImpl });
  const result = await installer.install(REPO, SHA);
  assert.equal(result.sha256, digest, 'the digest is computed locally when the repository does not publish one');
});

test('a malformed repository or revision cannot escape the cache directory', () => {
  const root = '/tmp/root';
  for (const [repo, revision] of [
    ['../../etc', SHA], ['owner/../repo', SHA], ['owner', SHA], ['owner/repo', 'main'],
    ['owner/repo', `${SHA}/..`], ['own er/repo', SHA], ['', SHA],
  ]) {
    assert.throws(() => policyPath(repo, revision, root), /Unknown market policy/, `${repo}@${revision}`);
  }
  assert.equal(policyPath('a/b', SHA, root), path.join(root, 'a', 'b', SHA, 'policy.onnx'));
});

test('removing an installed policy deletes the weights', async (t) => {
  const root = tempRoot(t);
  const installer = createInstaller({ root, fetchImpl: hub().fetchImpl });
  await installer.install(REPO, SHA);
  installer.remove(REPO, SHA);
  assert.equal(installer.isInstalled(REPO, SHA), false);
});

test('the cache lives in the user Hugging Face cache, not the repository', () => {
  assert.equal(defaultRoot('/home/someone'), path.join('/home/someone', '.cache', 'huggingface', 'duck-market'));
});
