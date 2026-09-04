const test = require("node:test");
const assert = require("node:assert/strict");
const prefs = require("../src/prefs");

test("duckAppearance and duckMuted are schema-backed preferences", () => {
  assert.equal(prefs.SCHEMA.duckAppearance.default, "classic");
  assert.deepEqual(prefs.SCHEMA.duckAppearance.enum, ["classic", "charcoal", "purple", "blue"]);
  assert.equal(prefs.SCHEMA.duckMuted.default, false);
});
