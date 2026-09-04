"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PRELOAD_SETTINGS = path.join(__dirname, "..", "src", "preload-settings.js");

function loadPreload() {
  const ipcHandlers = new Map();
  const exposed = new Map();
  const invokes = [];
  const ipcRenderer = {
    invoke: (...args) => {
      invokes.push(args);
      return Promise.resolve({ status: "ok" });
    },
    send: () => {},
    on(channel, handler) {
      ipcHandlers.set(channel, handler);
    },
    removeListener: () => {},
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed.set(name, value);
    },
  };
  const context = {
    console,
    process: { argv: [] },
    require(name) {
      if (name === "electron") return { contextBridge, ipcRenderer };
      throw new Error(`Unexpected preload dependency: ${name}`);
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(PRELOAD_SETTINGS, "utf8"), context, {
    filename: PRELOAD_SETTINGS,
  });
  return { exposed, ipcHandlers, invokes };
}

test("settings preload routes commands through the generic command IPC", async () => {
  const { exposed, invokes } = loadPreload();
  const settingsAPI = exposed.get("settingsAPI");
  for (const [action, payload] of [
    ["setThemeSelection", { themeId: "clawd" }],
    ["setIdleVisual", undefined],
  ]) {
    assert.deepEqual(await settingsAPI.command(action, payload), { status: "ok" });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(invokes)), [
    ["settings:command", { action: "setThemeSelection", payload: { themeId: "clawd" } }],
    ["settings:command", { action: "setIdleVisual" }],
  ]);
  assert.equal(typeof settingsAPI.setThemeSelection, "undefined");
});

test("settings preload exposes the three roam area operations", async () => {
  const { exposed, invokes } = loadPreload();
  const settingsAPI = exposed.get("settingsAPI");
  await settingsAPI.getRoamFence();
  await settingsAPI.selectRoamFence();
  await settingsAPI.clearRoamFence();
  assert.deepStrictEqual(invokes, [
    ["settings:get-roam-fence"],
    ["settings:select-roam-fence"],
    ["settings:clear-roam-fence"],
  ]);
});

