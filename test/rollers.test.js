const test = require("node:test");
const assert = require("node:assert/strict");

test("rollers module: locomotion normalisation, policy files, wheel joints and the crouch phase", async () => {
  const r = await import("../renderer/src/runtime/rollers.js");
  assert.deepEqual([r.normalizeLocomotion("rollers"), r.normalizeLocomotion("legs"), r.normalizeLocomotion("wheels"), r.normalizeLocomotion(undefined)], ["rollers", "legs", "legs", "legs"]);
  assert.deepEqual(r.ROLLER_POLICY_FILES, { walk: "BEST_roller.onnx", crouch: "BEST_roller_crouch.onnx" });
  assert.deepEqual(r.ROLLER_WHEEL_JOINTS, ["passive_LF_wheel", "passive_LR_wheel", "passive_RF_wheel", "passive_RR_wheel"]);
  assert.equal(r.ROLLER_CROUCH.periodS * r.ROLLER_CROUCH.endPhase, 3.5);
  assert.ok(r.ROLLER_BRAKE < 0 && r.ROLLER_BRAKE_ABOVE > 0);
  assert.equal(r.ROLLER_MAX_FORWARD, 0.5);
});
