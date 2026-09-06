const test = require("node:test");
const assert = require("node:assert/strict");

test("rollers module: locomotion normalisation, policy files, wheel joints and the crouch phase", async () => {
  const r = await import("../renderer/src/runtime/rollers.js");
  assert.deepEqual([r.normalizeLocomotion("rollers"), r.normalizeLocomotion("legs"), r.normalizeLocomotion("wheels"), r.normalizeLocomotion(undefined)], ["rollers", "legs", "legs", "legs"]);
  assert.deepEqual(r.ROLLER_POLICY_FILES, { walk: "BEST_roller.onnx", crouch: "BEST_roller_crouch.onnx" });
  assert.deepEqual(r.ROLLER_WHEEL_JOINTS, ["passive_LF_wheel", "passive_LR_wheel", "passive_RF_wheel", "passive_RR_wheel"]);
  assert.equal(r.ROLLER_CROUCH.periodS * r.ROLLER_CROUCH.endPhase, 3.5);
  assert.ok(r.ROLLER_BRAKE < 0 && r.ROLLER_BRAKE_ABOVE > 0);
  assert.equal(r.ROLLER_MAX_FORWARD, 0.33);
});

test("yawTrunk rotates a free-joint quaternion about world Z", async () => {
  const { yawTrunk, ROLLER_YAW_RATE } = await import("../renderer/src/runtime/rollers.js");
  assert.ok(ROLLER_YAW_RATE > 0);
  const yaw = (q) => Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
  const q = [0, 0, 0.1, 1, 0, 0, 0]; // identity orientation
  yawTrunk(q, Math.PI / 2);
  assert.ok(Math.abs(yaw(q) - Math.PI / 2) < 1e-9);
  for (let i = 0; i < 50; i++) yawTrunk(q, -0.02); // 1 rad back, in small steps
  assert.ok(Math.abs(yaw(q) - (Math.PI / 2 - 1)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(q[3], q[4], q[5], q[6]) - 1) < 1e-9); // still unit length
});
