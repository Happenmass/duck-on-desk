'use strict';
// The admission filter the pet runtime applies to everything it will play.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SHA12 = 'c0447da66825';
const marketEntry = (changes = {}) => ({
  id: `mkt_joanfox~microduck-happy-hop@${SHA12}`,
  url: 'pet-model://policy/market%2F...',
  contract: 'microduck-policy-v1',
  commandMode: 'zero-commands',
  duration: 3,
  ...changes,
});
const labEntry = (changes = {}) => ({
  id: 'run_36c63834-3f52-48d0-b838-08fc9dac41d8',
  url: 'pet-model://policy/lab%2F...',
  contract: 'duck-lab-action-v1',
  duration: 8,
  ...changes,
});

test('locally trained actions keep exactly the durations the lab admits', async () => {
  const { normalizeActionCatalog } = await import('../renderer/src/runtime/action-catalog.js');
  assert.equal(normalizeActionCatalog([labEntry()]).length, 1);
  const roulade = normalizeActionCatalog([labEntry({ duration: 5, task: 'microduck-roulade', policy_observations: 'official-zero-commands-v1' })]);
  assert.equal(roulade.length, 1);
  assert.equal(roulade[0].officialObservations, true);
  // A 5 s clip that is not the official roulade recipe is not admitted.
  assert.deepEqual(normalizeActionCatalog([labEntry({ duration: 5 })]), []);
  assert.deepEqual(normalizeActionCatalog([labEntry({ duration: 3 })]), []);
  assert.deepEqual(normalizeActionCatalog([labEntry({ contract: 'microduck-policy-v1' })]), []);
});

test('a market action plays on its own declared duration', async () => {
  const { normalizeActionCatalog } = await import('../renderer/src/runtime/action-catalog.js');
  for (const duration of [0.5, 0.88, 2.8, 3, 36, 60]) {
    const [entry] = normalizeActionCatalog([marketEntry({ duration })]);
    assert.ok(entry, `duration ${duration}`);
    assert.equal(entry.duration, duration);
    assert.equal(entry.market, true);
    assert.equal(entry.officialObservations, true, 'market clips run on an all-zero command block');
  }
});

test('only the zero-command kind of market policy is ever playable', async () => {
  const { normalizeActionCatalog } = await import('../renderer/src/runtime/action-catalog.js');
  // These are the ones whose command slots mean something we cannot supply --
  // feeding zeros would produce an unpredictable motion, not an error.
  for (const commandMode of ['velocity', 'manual', undefined, null, '']) {
    assert.deepEqual(normalizeActionCatalog([marketEntry({ commandMode })]), [], String(commandMode));
  }
});

test('a market entry without a usable duration is refused', async () => {
  const { normalizeActionCatalog } = await import('../renderer/src/runtime/action-catalog.js');
  for (const duration of [0, -1, 61, null, undefined, '3', Number.NaN, Infinity]) {
    assert.deepEqual(normalizeActionCatalog([marketEntry({ duration })]), [], String(duration));
  }
});

test('identifiers and contracts cannot be improvised', async () => {
  const { normalizeActionCatalog } = await import('../renderer/src/runtime/action-catalog.js');
  for (const id of ['mkt_bad', `mkt_owner~repo@${SHA12}extra`, 'mkt_owner~repo@ZZZZZZZZZZZZ', 'run_not-a-uuid', `../../mkt_a~b@${SHA12}`, '']) {
    assert.deepEqual(normalizeActionCatalog([marketEntry({ id })]), [], id);
  }
  assert.deepEqual(normalizeActionCatalog([marketEntry({ contract: 'duck-lab-action-v1' })]), [],
    'a market policy cannot claim the lab contract to borrow its rules');
  assert.deepEqual(normalizeActionCatalog([marketEntry({ url: undefined })]), []);
  assert.deepEqual(normalizeActionCatalog([marketEntry({ url: 42 })]), []);
});

test('junk in the list is dropped without taking the valid entries with it', async () => {
  const { normalizeActionCatalog } = await import('../renderer/src/runtime/action-catalog.js');
  const catalog = normalizeActionCatalog([null, undefined, 'string', 7, marketEntry(), labEntry(), {}]);
  assert.deepEqual(catalog.map((entry) => entry.market), [true, false]);
  assert.deepEqual(normalizeActionCatalog(null), []);
  assert.deepEqual(normalizeActionCatalog('actions'), []);
});
