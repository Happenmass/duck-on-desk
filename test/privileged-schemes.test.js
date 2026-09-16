'use strict';
// Guards the regression in src/shell/privileged-schemes.js: a second
// registerSchemesAsPrivileged() call strips secure/fetch/cors from the schemes
// registered by the first one, which silently stops the pet renderer from
// fetching its ONNX policies -- the duck never appears and nothing throws.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRIVILEGED_SCHEMES, registerPrivilegedSchemes } = require('../src/shell/privileged-schemes.js');

function recorder() {
  const calls = [];
  return { calls, protocol: { registerSchemesAsPrivileged: (schemes) => calls.push(schemes) } };
}

test('every privileged scheme is registered in a single call', () => {
  const { calls, protocol } = recorder();
  registerPrivilegedSchemes(protocol);
  assert.equal(calls.length, 1, 'more than one call would drop the earlier privileges');
  assert.deepEqual(calls[0].map((entry) => entry.scheme).sort(), ['pet-market', 'pet-model']);
});

test('the pet policy scheme keeps the privileges its renderer depends on', () => {
  const petModel = PRIVILEGED_SCHEMES.find((entry) => entry.scheme === 'pet-model');
  assert.ok(petModel, 'pet-model must stay registered');
  // onnxruntime-web reaches the policies through fetch() from the pet window.
  assert.equal(petModel.privileges.supportFetchAPI, true);
  assert.equal(petModel.privileges.corsEnabled, true);
  assert.equal(petModel.privileges.secure, true);
  assert.equal(petModel.privileges.standard, true);
});

test('the market media scheme can stream ranged video', () => {
  const petMarket = PRIVILEGED_SCHEMES.find((entry) => entry.scheme === 'pet-market');
  assert.ok(petMarket);
  assert.equal(petMarket.privileges.stream, true, '<video> needs streamed responses');
  assert.equal(petMarket.privileges.supportFetchAPI, true);
  assert.equal(petMarket.privileges.secure, true);
});

test('no protocol module exposes its own registration helper', () => {
  // The footgun is an individual module calling the API again; removing the
  // helper is what keeps a future scheme from being registered separately.
  for (const modulePath of ['../src/robots/duck/pet-model-protocol.js', '../src/market/media-protocol.js']) {
    const loaded = require(modulePath);
    assert.equal(loaded.registerScheme, undefined, `${modulePath} must not register schemes itself`);
    assert.ok(loaded.PRIVILEGED_SCHEME, `${modulePath} must declare its scheme instead`);
  }
});

test('the main process calls the shared registration exactly once', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const direct = source.match(/registerSchemesAsPrivileged/g) || [];
  assert.equal(direct.length, 0, 'main.js must go through privileged-schemes.js');
  const shared = source.match(/registerPrivilegedSchemes\(/g) || [];
  assert.equal(shared.length, 1);
});
