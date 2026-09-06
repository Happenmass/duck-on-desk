const test = require("node:test");
const assert = require("node:assert/strict");
const { createRobotPowerControl, createRobotErrorNotifier } = require("../src/robots/reachy/robot-power-control");

test("one wake command works offline and with any robot adapter", async () => {
  const calls = []; let adapter = null;
  const c = createRobotPowerControl({ getAdapter: () => adapter, wakeDesktop: () => calls.push("desktop") });
  await c.wake(); assert.deepEqual(calls, ["desktop"]);
  adapter = { snapshot: () => ({ connected: true, motionEnabled: false }), wakeUp: async () => calls.push("motors") };
  assert.equal(c.needsWake(), true);
  await c.wake(); assert.deepEqual(calls, ["desktop", "motors", "desktop"]);
});

test("wake deduplicates clicks, preserves sleep on failure, and ignores a switched robot", async () => {
  let finish, woke = 0;
  let adapter = { snapshot: () => ({ connected: true }), wakeUp: () => new Promise(resolve => { finish = resolve; }) };
  const c = createRobotPowerControl({ getAdapter: () => adapter, wakeDesktop: () => woke++ });
  const a = c.wake(); assert.equal(c.wake(), a); assert.equal(c.isBusy(), true);
  adapter = null; finish(); await a; assert.equal(woke, 0);
  adapter = { snapshot: () => ({ connected: true }), wakeUp: async () => { throw new Error("offline"); } };
  await assert.rejects(c.wake(), /offline/); assert.equal(woke, 0); assert.equal(c.isBusy(), false);
});

test("an automatic lifecycle failure is reported once and never over the explicit wake dialog", () => {
  const shown = []; let explicit = false;
  const notify = createRobotErrorNotifier({ showError: error => shown.push(error), isExplicitWake: () => explicit });
  notify({ motionError: null });
  notify({ motionError: "sleep refused" });
  notify({ motionError: "sleep refused" });
  assert.deepEqual(shown, ["sleep refused"], "one dialog per failure, not per status update");
  notify({ motionError: null });
  explicit = true;
  notify({ motionError: "wake refused" });
  assert.deepEqual(shown, ["sleep refused"], "the menu wake reports its own failure");
  explicit = false;
  notify({ motionError: null });
  notify({ motionError: "sleep refused" });
  assert.deepEqual(shown, ["sleep refused", "sleep refused"], "a later failure is reported again");
});
