'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveMediaRequest, mediaUrl, ORIGIN } = require('../src/market/media-protocol.js');

const SHA = 'a'.repeat(40);

test('a well-formed preview resolves to one pinned Hub URL', () => {
  const resolved = resolveMediaRequest(mediaUrl('RemiFabre', 'microduck-flamingo-cycle', SHA, 'media/preview.mp4'));
  assert.equal(resolved.status, 200);
  assert.equal(resolved.url, `${ORIGIN}/RemiFabre/microduck-flamingo-cycle/resolve/${SHA}/media/preview.mp4`);
  assert.equal(resolved.contentType, 'video/mp4');
});

test('the filename shapes real listings use are accepted', () => {
  // joanfox/microduck-happy-hop publishes exactly this name.
  const tilde = resolveMediaRequest(mediaUrl('joanfox', 'microduck-happy-hop', SHA, 'media/PXL_20260901_133625139.TS~2.mp4'));
  assert.equal(tilde.status, 200);
  const flat = resolveMediaRequest(mediaUrl('tfrere', 'microduck-move-base-walk', SHA, 'video.mp4'));
  assert.equal(flat.status, 200);
  const poster = resolveMediaRequest(mediaUrl('tfrere', 'microduck-move-base-walk', SHA, 'poster.jpg'));
  assert.equal(poster.contentType, 'image/jpeg');
});

test('path traversal cannot escape the pinned repository', () => {
  for (const file of ['../../etc/passwd.png', 'media/../../../secret.png', '..%2F..%2Fsecret.png', 'media/..\\win.png']) {
    const resolved = resolveMediaRequest(mediaUrl('a', 'b', SHA, file));
    assert.notEqual(resolved.status, 200, file);
  }
});

test('only media file types are proxied', () => {
  for (const file of ['policy.onnx', 'control.py', 'manifest.json', 'README.md', 'checkpoint.pt', 'noextension']) {
    const resolved = resolveMediaRequest(mediaUrl('a', 'b', SHA, file));
    assert.equal(resolved.status, 415, file);
  }
});

test('the revision must be a full commit hash, so a listing cannot be pointed at a moving ref', () => {
  for (const revision of ['main', 'refs/heads/main', 'a'.repeat(39), 'A'.repeat(40), `${SHA}/..`]) {
    const resolved = resolveMediaRequest(`pet-market://media/owner/repo/${revision}/media/preview.mp4`);
    assert.notEqual(resolved.status, 200, revision);
  }
});

test('a repository name cannot smuggle a different host or path', () => {
  assert.notEqual(resolveMediaRequest(`pet-market://media/..%2F..%2Fevil/repo/${SHA}/a.png`).status, 200);
  assert.notEqual(resolveMediaRequest(`pet-market://media/own%2Fer/repo/${SHA}/a.png`).status, 200);
  assert.notEqual(resolveMediaRequest(`pet-market://media/-lead/repo/${SHA}/a.png`).status, 200);
});

test('anything but the media resource is refused', () => {
  assert.equal(resolveMediaRequest(`pet-market://policy/owner/repo/${SHA}/a.png`).status, 404);
  assert.equal(resolveMediaRequest(`pet-market://media/owner/repo/${SHA}`).status, 404);
  assert.equal(resolveMediaRequest('pet-market://media/').status, 404);
  assert.equal(resolveMediaRequest(`https://huggingface.co/owner/repo/${SHA}/a.png`).status, 400);
  assert.equal(resolveMediaRequest('not a url').status, 400);
});

test('a query or fragment is refused rather than forwarded', () => {
  assert.equal(resolveMediaRequest(`pet-market://media/a/b/${SHA}/x.png?token=secret`).status, 400);
  assert.equal(resolveMediaRequest(`pet-market://media/a/b/${SHA}/x.png#frag`).status, 400);
});

test('an overlong path is refused before it is parsed', () => {
  const long = `${'segment/'.repeat(80)}x.png`;
  assert.equal(resolveMediaRequest(mediaUrl('a', 'b', SHA, long)).status, 414);
});
