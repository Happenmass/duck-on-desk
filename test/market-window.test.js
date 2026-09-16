'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMarketWindow } = require('../src/shell/market-window.js');

// Minimal stand-ins for the Electron surfaces the window touches.
function harness({ listImpl, catalogEntries, installImpl } = {}) {
  let handler = null;
  const opened = [];
  const windows = [];
  const ipcMain = { handle: (channel, fn) => { if (channel === 'market:request') handler = fn; } };
  const BrowserWindow = function (options) {
    const contents = { send() {}, setWindowOpenHandler() {}, on() {}, getURL: () => 'file://market' };
    Object.assign(this, {
      options, webContents: contents, listeners: {},
      isDestroyed: () => false, isMinimized: () => false, isVisible: () => true,
      show() { this.shown = true; }, focus() {}, restore() {}, destroy() {},
      loadFile(file) { this.loaded = file; }, loadURL(url) { this.loaded = url; },
      once(event, fn) { this.listeners[event] = fn; },
      on(event, fn) { this.listeners[event] = fn; },
    });
    windows.push(this);
  };
  BrowserWindow.getFocusedWindow = () => null;
  const records = [];
  const removed = [];
  const labOpens = [];
  const runtime = createMarketWindow({
    app: { on() {}, off() {} }, BrowserWindow, ipcMain,
    shell: { openExternal: async (url) => { opened.push(url); } },
    getCatalog: () => ({ list: listImpl || (async () => ({ entries: catalogEntries || [], counts: {} })) }),
    getInstaller: () => ({
      install: installImpl || (async () => ({ file: '/cache/policy.onnx', bytes: 793778, sha256: 'a'.repeat(64) })),
      remove: (repo, revision) => removed.push(`${repo}@${revision}`),
    }),
    getStore: () => ({
      list: () => records.slice(),
      record: (entry) => { records.push({ ...entry, id: `mkt_${entry.repo.replace('/', '~')}@${entry.revision.slice(0, 12)}`, state: 'downloaded' }); return records.slice(); },
      forget: (id) => { const index = records.findIndex((item) => item.id === id); if (index >= 0) records.splice(index, 1); return records.slice(); },
    }),
    openLab: () => labOpens.push(Date.now()),
  });
  const from = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  // The real Electron event exposes mainFrame on the sender; mirror that.
  const trust = (window) => { window.webContents.mainFrame = window.webContents; return from(window); };
  return { runtime, call: (event, action, payload) => handler(event, { action, payload }), windows, opened, trust, from, records, removed, labOpens };
}

test('requests from anything but the market window are refused', async () => {
  const { runtime, call, windows, trust } = harness();
  runtime.open();
  const other = { sender: { mainFrame: {} }, senderFrame: {} };
  await assert.rejects(() => call(other, 'list', {}), /market window/);
  const result = await call(trust(windows[0]), 'list', {});
  assert.deepEqual(result.entries, []);
});

test('an unknown action is reported rather than thrown at the renderer', async () => {
  const { runtime, call, windows, trust } = harness();
  runtime.open();
  const result = await call(trust(windows[0]), 'run-arbitrary-policy', {});
  assert.match(result.error, /Unknown market action/);
});

test('concurrent listing clicks share one fetch, and force starts a new one', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { runtime, call, windows, trust } = harness({
    listImpl: async () => { calls += 1; await gate; return { entries: [], counts: {} }; },
  });
  runtime.open();
  const event = trust(windows[0]);
  const both = Promise.all([call(event, 'list', {}), call(event, 'list', {})]);
  release();
  await both;
  assert.equal(calls, 1);
  await call(event, 'list', { force: true });
  assert.equal(calls, 2);
});

test('only a Hub repository page can be opened, and the URL is built here', async () => {
  const { runtime, call, windows, opened, trust } = harness();
  runtime.open();
  const event = trust(windows[0]);
  await call(event, 'open-repository', { repo: 'RemiFabre/microduck-flamingo-cycle' });
  assert.deepEqual(opened, ['https://huggingface.co/RemiFabre/microduck-flamingo-cycle']);
  for (const repo of ['https://evil.example/x', '../../etc', 'owner', 'owner/repo/extra', '', null, 'own er/repo']) {
    const result = await call(event, 'open-repository', { repo });
    assert.match(result.error, /Unknown repository/, String(repo));
  }
  assert.equal(opened.length, 1);
});

test('reopening focuses the existing window instead of making a second one', () => {
  const { runtime, windows } = harness();
  runtime.open();
  runtime.open();
  assert.equal(windows.length, 1);
});

test('the window is sandboxed, context-isolated and has no node integration', () => {
  const { runtime, windows } = harness();
  runtime.open();
  const { webPreferences } = windows[0].options;
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.match(webPreferences.preload, /preload-market\.js$/);
});

const READY = {
  repo: 'joanfox/microduck-happy-hop', sha: 'c'.repeat(40), title: '开心跳',
  status: 'ready', kind: 'episodic', commandMode: 'zero-commands', duration: 3,
};

test('only a policy the catalogue judged usable can be downloaded', async () => {
  const notReady = [
    { ...READY, repo: 'a/manual', status: 'manual' },
    { ...READY, repo: 'a/unverifiable', status: 'unverifiable' },
    { ...READY, repo: 'a/incompatible', status: 'incompatible' },
  ];
  const { runtime, call, windows, trust, records } = harness({ catalogEntries: notReady });
  runtime.open();
  const event = trust(windows[0]);
  for (const entry of notReady) {
    const result = await call(event, 'install', { repo: entry.repo, revision: entry.sha });
    assert.match(result.error, /尚未确认可用/, entry.repo);
  }
  // A repository the classifier never saw cannot be smuggled in by the renderer.
  const unknown = await call(event, 'install', { repo: 'someone/else', revision: READY.sha });
  assert.match(unknown.error, /尚未确认可用/);
  assert.deepEqual(records, []);
});

test('a usable policy downloads and is recorded as not yet accepted', async () => {
  const { runtime, call, windows, trust, records } = harness({ catalogEntries: [READY] });
  runtime.open();
  const event = trust(windows[0]);
  const entries = await call(event, 'install', { repo: READY.repo, revision: READY.sha });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].state, 'downloaded', 'downloading is not accepting');
  assert.equal(records[0].sha256, 'a'.repeat(64));
  assert.equal(records[0].duration, 3);
  assert.equal(records[0].commandMode, 'zero-commands');
  const listed = await call(event, 'installed', {});
  assert.equal(listed.length, 1);
});

test('a download failure is reported without recording anything', async () => {
  const { runtime, call, windows, trust, records } = harness({
    catalogEntries: [READY],
    installImpl: async () => { throw new Error('下载内容的校验和与仓库记录不一致'); },
  });
  runtime.open();
  const result = await call(trust(windows[0]), 'install', { repo: READY.repo, revision: READY.sha });
  assert.match(result.error, /校验和/);
  assert.deepEqual(records, []);
});

test('forgetting a policy removes both the record and the weights', async () => {
  const { runtime, call, windows, trust, records, removed } = harness({ catalogEntries: [READY] });
  runtime.open();
  const event = trust(windows[0]);
  await call(event, 'install', { repo: READY.repo, revision: READY.sha });
  const id = records[0].id;
  const left = await call(event, 'forget', { id });
  assert.deepEqual(left, []);
  assert.deepEqual(removed, [`${READY.repo}@${READY.sha}`]);
  const missing = await call(event, 'forget', { id: 'mkt_nope@000000000000' });
  assert.match(missing.error, /不在已下载列表/);
});

test('the market never plays a policy itself; it opens the laboratory', async () => {
  const { runtime, call, windows, trust, labOpens } = harness({ catalogEntries: [READY] });
  runtime.open();
  await call(trust(windows[0]), 'open-lab', {});
  assert.equal(labOpens.length, 1);
});
