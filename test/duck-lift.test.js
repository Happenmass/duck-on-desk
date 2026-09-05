"use strict";
// duck-on-desk: middle-button pick-up — the window covers the work area while
// held, and shrinks back around the landing spot once the renderer reports it.
const test = require("node:test");
const assert = require("node:assert/strict");
const createDuckLift = require("../src/duck-lift");

function harness() {
  const calls = [];
  let bounds = { x: 1500, y: 700, width: 184, height: 184 };
  const win = { destroyed: false, isDestroyed: () => win.destroyed, setBounds: (b) => calls.push(["setBounds", b]) };
  const timers = [];
  const lift = createDuckLift({
    getRenderWindow: () => win,
    screen: { getDisplayMatching: () => ({ workArea: { x: 100, y: 25, width: 1820, height: 1055 } }) },
    getPetWindowBounds: () => ({ ...bounds }),
    applyPetWindowBounds: (b, opts) => { calls.push(["apply", b, opts]); bounds = { ...b }; },
    syncHitWin: () => calls.push(["syncHitWin"]),
    sendToRenderer: (...a) => calls.push(["send", ...a]),
    cancelRoam: () => calls.push(["cancelRoam"]),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  return { lift, calls, timers, win, getBounds: () => bounds };
}

test("begin: renderer is told the old spot in work-area coords, then the window covers the work area", () => {
  const h = harness();
  const origin = h.lift.begin();
  assert.deepEqual(origin, { x: 1400, y: 675, width: 184, height: 184, floor: 1055, right: 1820 });
  assert.deepEqual(h.calls, [
    ["cancelRoam"],
    ["send", "duck-lift", { phase: "start", x: 1400, y: 675, width: 184, height: 184, floor: 1055, right: 1820 }],
    ["setBounds", { x: 100, y: 25, width: 1820, height: 1055 }],
  ]);
  assert.equal(h.lift.isActive(), true);
  assert.equal(h.lift.begin(), null, "a second press while held is ignored");
});

test("move and release only forward while a lift is active; landing shrinks the window around the spot", () => {
  const h = harness();
  h.lift.move(5, 5);
  h.lift.release();
  h.lift.land(10, 10);
  assert.deepEqual(h.calls, [], "nothing happens without a press");
  h.lift.begin();
  h.calls.length = 0;
  h.lift.move(-300, -400);
  h.lift.release();
  h.lift.land(1100.4, 871);
  assert.deepEqual(h.calls, [
    ["send", "duck-lift", { phase: "move", dx: -300, dy: -400 }],
    ["send", "duck-lift", { phase: "end" }],
    ["send", "duck-lift", { phase: "reset" }],
    ["apply", { x: 1200, y: 896, width: 184, height: 184 }, { force: true }],
    ["syncHitWin"],
  ]);
  assert.equal(h.lift.isActive(), false);
  assert.equal(h.timers[0].fn, null, "the landing cleared the watchdog");
});

test("landing coordinates are clamped inside the work area", () => {
  const h = harness();
  h.lift.begin();
  h.lift.land(-50, 99999);
  const apply = h.calls.find((c) => c[0] === "apply");
  assert.deepEqual(apply[1], { x: 100, y: 25 + 1055 - 184, width: 184, height: 184 });
});

test("watchdog: a release the renderer never answers puts the window back where it was", () => {
  const h = harness();
  h.lift.begin();
  h.lift.release();
  assert.equal(h.timers.length, 1);
  h.timers[0].fn();
  const apply = h.calls.find((c) => c[0] === "apply");
  assert.deepEqual(apply[1], { x: 1500, y: 700, width: 184, height: 184 });
  assert.equal(h.lift.isActive(), false);
});
