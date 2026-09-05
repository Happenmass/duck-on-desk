const test = require("node:test");
const assert = require("node:assert/strict");
const prefs = require("../src/prefs");

test("duckAppearance and duckMuted are schema-backed preferences", () => {
  assert.equal(prefs.SCHEMA.duckAppearance.default, "classic");
  assert.deepEqual(prefs.SCHEMA.duckAppearance.enum, ["classic", "charcoal", "purple", "blue"]);
  assert.equal(prefs.SCHEMA.duckMuted.default, false);
});

test("settings registry accepts skin and mute updates from the menu", () => {
  const { updateRegistry } = require("../src/settings-actions");
  assert.equal(updateRegistry.duckAppearance("blue").status, "ok");
  assert.equal(updateRegistry.duckAppearance("neon").status, "error");
  assert.equal(updateRegistry.duckMuted(true).status, "ok");
  assert.equal(updateRegistry.duckMuted("yes").status, "error");
});
