// Vendored from microduck-desktop-pet tests/motion-leases.test.js.
// This package is CJS, so the ESM runtime module is pulled in with await import().
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../renderer/src/runtime/motion-leases.js");

test("local motion preempts autonomy and yields when cleared", async () => {
  const { MotionLeases } = await load();
  const leases = new MotionLeases();
  leases.set("autonomy", { forward: 0.5, turn: 0.2 }, { now: 0 });
  leases.set("local", { forward: 1, turn: -1 }, { now: 1 });
  assert.deepEqual(leases.current(2), { source: "local", forward: 1, turn: -1 });
  leases.clear("local");
  assert.deepEqual(leases.current(3), { source: "autonomy", forward: 0.5, turn: 0.2 });
});

test("expired motion returns the safe zero command", async () => {
  const { MotionLeases } = await load();
  const leases = new MotionLeases();
  leases.set("mcp", { forward: 1, turn: 0 }, { ttlMs: 100, now: 10 });
  assert.equal(leases.current(109).source, "mcp");
  assert.deepEqual(leases.current(110), { source: null, forward: 0, turn: 0 });
});

test("motion input is clamped and unknown sources are rejected", async () => {
  const { MotionLeases } = await load();
  const leases = new MotionLeases();
  leases.set("local", { forward: 9, turn: -4 }, { now: 0 });
  assert.deepEqual(leases.current(1), { source: "local", forward: 1, turn: -1 });
  assert.throws(() => leases.set("random", { forward: 0, turn: 0 }), /unknown motion source/);
});
