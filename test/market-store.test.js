'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMarketStore, marketId, policyUrl, defaultFile } = require('../src/market/store.js');

const REPO = 'joanfox/microduck-happy-hop';
const SHA = 'c'.repeat(40);
const DIGEST = 'a'.repeat(64);

function store(t, { exists = () => true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-market-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'installed.json');
  return { store: createMarketStore({ file, exists }), file };
}

const entry = (changes = {}) => ({
  repo: REPO, revision: SHA, name: '开心跳', kind: 'episodic',
  commandMode: 'zero-commands', duration: 3, sha256: DIGEST, file: '/cache/policy.onnx', ...changes,
});

const trial = (changes = {}) => ({
  id: marketId(REPO, SHA), sha256: DIGEST, nonFinite: false, outputs: 14, steps: 150, userConfirmed: true, ...changes,
});

test('a downloaded policy is recorded but is not yet usable by the pet', (t) => {
  const { store: s } = store(t);
  const entries = s.record(entry());
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, 'downloaded');
  assert.equal(entries[0].id, marketId(REPO, SHA));
  assert.deepEqual(s.admitted(), [], 'downloading is not accepting');
});

test('admission requires a trial run produced here for this exact policy', (t) => {
  const { store: s } = store(t);
  s.record(entry());
  const id = marketId(REPO, SHA);
  assert.throws(() => s.admit(id, null), /试播/);
  assert.throws(() => s.admit(id, trial({ id: 'mkt_other@1' })), /试播/);
  // The author's own numbers are not this machine's trial.
  assert.throws(() => s.admit(id, trial({ sha256: 'b'.repeat(64) })), /试播/);
  assert.throws(() => s.admit(id, trial({ userConfirmed: false })), /确认/);
  assert.throws(() => s.admit(id, trial({ nonFinite: true })), /确认/);
  assert.throws(() => s.admit(id, trial({ outputs: 12 })), /确认/);
  assert.throws(() => s.admit(id, trial({ steps: 10 })), /确认/);
  assert.deepEqual(s.admitted(), []);

  const entries = s.admit(id, trial());
  assert.equal(entries[0].state, 'admitted');
  assert.equal(s.admitted().length, 1);
});

test('re-recording a revision keeps an admission the user already gave', (t) => {
  const { store: s } = store(t);
  s.record(entry());
  s.admit(marketId(REPO, SHA), trial());
  const entries = s.record(entry({ name: '开心跳 2' }));
  assert.equal(entries.length, 1, 'the same revision is not duplicated');
  assert.equal(entries[0].state, 'admitted');
  assert.equal(entries[0].name, '开心跳 2');
});

test('a different revision of the same repository is a separate action', (t) => {
  const { store: s } = store(t);
  s.record(entry());
  s.admit(marketId(REPO, SHA), trial());
  const other = 'd'.repeat(40);
  const entries = s.record(entry({ revision: other }));
  assert.equal(entries.length, 2);
  assert.equal(entries.find((item) => item.revision === other).state, 'downloaded',
    'a new revision must be tried again before it reaches the pet');
});

test('an entry whose weights have disappeared stops being listed', (t) => {
  let present = true;
  const { store: s } = store(t, { exists: () => present });
  s.record(entry());
  assert.equal(s.list().length, 1);
  present = false;
  assert.deepEqual(s.list(), []);
});

test('a hand-edited file cannot put an unchecked policy in front of the pet', (t) => {
  const { store: s, file } = store(t);
  s.record(entry());
  s.admit(marketId(REPO, SHA), trial());
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const original = payload.entries[0];

  for (const broken of [
    { ...original, revision: 'main' },
    { ...original, sha256: 'not-a-digest' },
    { ...original, repo: '../../etc/passwd' },
    { ...original, commandMode: 'guess' },
    { ...original, kind: 'whatever' },
    { ...original, state: 'trusted' },
    { ...original, duration: 999 },
    { ...original, name: '' },
  ]) {
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [broken] }));
    assert.deepEqual(s.list(), [], JSON.stringify(broken).slice(0, 60));
  }

  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(s.list(), []);
  fs.writeFileSync(file, JSON.stringify({ version: 99, entries: [original] }));
  assert.deepEqual(s.list(), []);
});

test('recording refuses a policy it could not identify or name', (t) => {
  const { store: s } = store(t);
  assert.throws(() => s.record(entry({ repo: 'nope' })), /Unknown market policy/);
  assert.throws(() => s.record(entry({ revision: 'main' })), /Unknown market policy/);
  assert.throws(() => s.record(entry({ sha256: 'short' })), /digest/);
  assert.throws(() => s.record(entry({ name: '   ' })), /1–40/);
  assert.throws(() => s.record(entry({ name: 'x'.repeat(41) })), /1–40/);
  assert.throws(() => s.record(entry({ kind: 'weird' })), /声明/);
});

test('forgetting an entry removes it from both lists', (t) => {
  const { store: s } = store(t);
  s.record(entry());
  s.admit(marketId(REPO, SHA), trial());
  s.forget(marketId(REPO, SHA));
  assert.deepEqual(s.list(), []);
  assert.deepEqual(s.admitted(), []);
});

test('the policy URL is the market route the protocol handler understands', () => {
  assert.equal(policyUrl(REPO, SHA),
    `pet-model://policy/${encodeURIComponent(`market/joanfox/microduck-happy-hop/${SHA}/policy.onnx`)}`);
  assert.equal(marketId(REPO, SHA), `mkt_joanfox~microduck-happy-hop@${SHA.slice(0, 12)}`);
});

test('the record lives under the app directory', () => {
  assert.equal(defaultFile('/home/someone'), path.join('/home/someone', '.duck-on-desk', 'market', 'installed.json'));
});
