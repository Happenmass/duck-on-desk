const test = require("node:test");
const assert = require("node:assert/strict");
const prefs = require("../src/shell/prefs");

test("duckAppearance and duckMuted are schema-backed preferences", () => {
  assert.equal(prefs.SCHEMA.duckAppearance.default, "classic");
  assert.deepEqual(prefs.SCHEMA.duckAppearance.enum, ["classic", "charcoal", "purple", "blue"]);
  assert.equal(prefs.SCHEMA.duckMuted.default, false);
});

test("settings registry accepts skin and mute updates from the menu", () => {
  const { updateRegistry } = require("../src/shell/settings-actions");
  assert.equal(updateRegistry.duckAppearance("blue").status, "ok");
  assert.equal(updateRegistry.duckAppearance("neon").status, "error");
  assert.equal(updateRegistry.duckMuted(true).status, "ok");
  assert.equal(updateRegistry.duckMuted("yes").status, "error");
});

test("duckVoiceVolume and duckStepVolume are 0..1 preferences with their own registry validators", () => {
  const prefs = require("../src/shell/prefs");
  const { updateRegistry } = require("../src/shell/settings-actions");
  assert.equal(prefs.SCHEMA.duckVoiceVolume.default, 1);
  assert.equal(prefs.SCHEMA.duckStepVolume.default, 1);
  assert.equal(prefs.SCHEMA.duckStepVolume.validate(0.35), true);
  assert.equal(prefs.SCHEMA.duckStepVolume.validate(1.5), false);
  assert.equal(updateRegistry.duckVoiceVolume(0.5).status, "ok");
  assert.equal(updateRegistry.duckVoiceVolume(2).status, "error");
  assert.equal(updateRegistry.duckStepVolume("loud").status, "error");
});

test("duckStilts is an enumerated height preference (0 = own feet)", () => {
  const prefs = require("../src/shell/prefs");
  const { updateRegistry } = require("../src/shell/settings-actions");
  assert.equal(prefs.SCHEMA.duckStilts.default, 0);
  assert.equal(prefs.SCHEMA.duckStilts.validate(25), true);
  assert.equal(prefs.SCHEMA.duckStilts.validate(30), false);
  assert.equal(updateRegistry.duckStilts(200).status, "ok");
  assert.equal(updateRegistry.duckStilts(12).status, "error");
  assert.equal(updateRegistry.duckStilts("25").status, "error");
});

test("duckLocomotion is a legs/rollers preference", () => {
  const prefs = require("../src/shell/prefs");
  const { updateRegistry } = require("../src/shell/settings-actions");
  assert.equal(prefs.SCHEMA.duckLocomotion.default, "legs");
  assert.deepEqual(prefs.SCHEMA.duckLocomotion.enum, ["legs", "rollers"]);
  assert.equal(updateRegistry.duckLocomotion("rollers").status, "ok");
  assert.equal(updateRegistry.duckLocomotion("wheels").status, "error");
});
