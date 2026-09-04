const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

test("runtime i18n only ships en, zh and zh-TW", () => {
  const { i18n, SUPPORTED_LANGS } = require("../src/i18n");
  assert.deepEqual([...SUPPORTED_LANGS], ["en", "zh", "zh-TW"]);
  assert.deepEqual(Object.keys(i18n).sort(), ["en", "zh", "zh-TW"]);
});

test("settings i18n has no strings for removed subsystems", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "settings-i18n.js"), "utf8");
  const root = {};
  vm.runInNewContext(src, { globalThis: root });
  const strings = root.DuckSettingsI18n.STRINGS;
  assert.deepEqual(Object.keys(strings).sort(), ["en", "zh", "zh-TW"]);
  const banned = /telegram|feishu|lark|slack|discord|remoteSsh|recap|kimi|tutorial|mobile/i;
  for (const key of Object.keys(strings.en)) assert.ok(!banned.test(key), `leftover key ${key}`);
});
