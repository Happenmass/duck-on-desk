// Vendored from microduck-desktop-pet tests/gestures.test.js.
// This package is CJS, so the ESM runtime modules are pulled in with await import().
const test = require("node:test");
const assert = require("node:assert/strict");

const gestures = () => import("../renderer/src/runtime/gestures.js");
const autonomy = () => import("../renderer/src/adapters/autonomy-adapter.js");
const leases = () => import("../renderer/src/runtime/motion-leases.js");

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test("ground-pick jaw opens on approach and snaps shut on the scoop", async () => {
  const { pickJawOpenness } = await gestures();
  assert.equal(pickJawOpenness(undefined), 0);
  assert.equal(pickJawOpenness(0), 0);
  near(pickJawOpenness(0.15), 0.5);
  assert.equal(pickJawOpenness(0.3), 1);
  near(pickJawOpenness(0.45), 0.5);
  assert.equal(pickJawOpenness(0.6), 0);
});

test("quack flap is a half sine over QUACK_MS", async () => {
  const { quackJawOpenness } = await gestures();
  assert.equal(quackJawOpenness(-1), 0);
  near(quackJawOpenness(240), 1);
  assert.equal(quackJawOpenness(480), 0);
});

test("idle actions are picked by cumulative weight", async () => {
  const { chooseIdleAction, IDLE_ACTIONS } = await autonomy();
  near(IDLE_ACTIONS.reduce((sum, [, w]) => sum + w, 0), 1);
  assert.equal(chooseIdleAction(0), "look");
  assert.equal(chooseIdleAction(0.44), "look");
  assert.equal(chooseIdleAction(0.46), "wander");
  assert.equal(chooseIdleAction(0.65), "wander");
  assert.equal(chooseIdleAction(0.85), "peck");
  assert.equal(chooseIdleAction(0.95), "quack");
  assert.equal(chooseIdleAction(0.9999), "quack");
});

test("footstep fires once per lift-and-land with debounce", async () => {
  const { footLanding } = await gestures();
  const foot = { air: false, prevZ: 0, lastAt: -1000 };
  assert.equal(footLanding(foot, 0, 0, 0.02, 0), null);
  assert.equal(footLanding(foot, 0.02, 0, 0.02, 20), null);
  assert.ok(foot.air);
  const gain = footLanding(foot, 0.002, 0, 0.02, 40);
  assert.ok(gain > 0.12 && gain <= 0.2601, String(gain));
  assert.equal(footLanding(foot, 0.02, 0, 0.02, 60), null);
  assert.equal(footLanding(foot, 0.002, 0, 0.02, 80), null);
});

test("landing thump ignores gait and fires on a fast vertical stop", async () => {
  const { landingImpact } = await gestures();
  assert.equal(landingImpact(-0.2, 0.1), null);
  assert.equal(landingImpact(-1.0, -0.9), null);
  near(landingImpact(-1.9, 0), 1);
  assert.ok(landingImpact(-0.5, 0) > 0);
});

test("heading controller is bang-bang with hysteresis on the short arc", async () => {
  const { headingTurn, wrapAngle } = await gestures();
  assert.deepEqual(headingTurn(0.59, 0, false), { turn: 1, engaged: true });
  assert.deepEqual(headingTurn(-0.3, 0, false), { turn: -1, engaged: true });
  assert.deepEqual(headingTurn(0.2, 0, false), { turn: 0, engaged: false });
  assert.deepEqual(headingTurn(0.2, 0, true), { turn: 1, engaged: true });
  assert.deepEqual(headingTurn(0.1, 0, true), { turn: 0, engaged: false });
  near(wrapAngle(3.0 - -3.0), 6 - 2 * Math.PI);
  assert.equal(headingTurn(3.0, -3.0, false).turn, -1);
});

test("motion lease passes an optional heading through", async () => {
  const { MotionLeases } = await leases();
  const l = new MotionLeases();
  l.set("autonomy", { forward: 0.5, heading: 0.8 }, { now: 0 });
  assert.equal(l.current(1).heading, 0.8);
  l.set("local", { forward: 1, turn: 1 }, { now: 2 });
  assert.equal(l.current(3).heading, undefined);
});
