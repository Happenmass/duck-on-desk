"use strict";
// duck-on-desk: free roam walks toward the side the 3D duck leans to, drifts
// only modestly up or down, and skips the walk when that side has no room.
const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert");
const roamModule = require("../src/roam");

function makeCtx({ x, lean, speed }) {
  const bounds = { x, y: 400, width: 120, height: 120 };
  const applied = [];
  const headings = [];
  let currentState = "idle";
  const ctx = {
    win: { getBounds: () => ({ ...bounds }), setBounds() {}, isDestroyed: () => false },
    getPetWindowBounds: () => ({ ...bounds }),
    applyPetWindowBounds(next) { applied.push({ x: next.x, y: next.y }); Object.assign(bounds, next); },
    applyPetWindowPosition(nx, ny) { ctx.applyPetWindowBounds({ ...bounds, x: nx, y: ny }); },
    syncHitWin() {}, repositionSessionHud() {}, repositionAnchoredSurfaces() {}, repositionBubbles() {},
    bubbleFollowPet: false, pendingPermissions: [],
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    clampToScreenVisual: (cx, cy, w, h) => ({ x: cx, y: cy, width: w, height: h }),
    getMiniMode: () => false,
    getCurrentState: () => currentState,
    dragLocked: false, miniTransitioning: false,
    applyState: (s) => { currentState = s; },
    setState: (s) => { currentState = s; },
    setRoamHeading: (left) => headings.push(left ? "L" : "R"),
    getDuckLean: () => lean,
    roamSpeedPxPerMs: speed,
  };
  return { ctx, applied, headings, start: { x: bounds.x, y: bounds.y } };
}

function runFor(roam, seconds) {
  for (let i = 0; i < seconds; i += 1) { roam.tick(); mock.timers.tick(1000); }
}

describe("roam follows the duck's lean", () => {
  beforeEach(() => { mock.timers.enable({ apis: ["setTimeout", "Date"] }); });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  it("walks left with a bounded vertical drift when the duck leans left", () => {
    const h = makeCtx({ x: 900, lean: -1 });
    const roam = roamModule(h.ctx);
    roam.setEnabled(true);
    runFor(roam, 12);
    assert.ok(h.applied.length > 0, "the walk should have started");
    const last = h.applied[h.applied.length - 1];
    assert.ok(last.x < h.start.x, `expected a leftward walk, got x ${h.start.x} -> ${last.x}`);
    assert.deepStrictEqual(h.headings, ["L"]);
    const dx = Math.abs(last.x - h.start.x);
    const dy = Math.abs(last.y - h.start.y);
    assert.ok(dy <= Math.max(24, Math.round(dx * 0.6)) + 1, `vertical drift ${dy} exceeds 60% of horizontal ${dx}`);
  });

  it("walks right when the duck leans right", () => {
    const h = makeCtx({ x: 900, lean: 1 });
    const roam = roamModule(h.ctx);
    roam.setEnabled(true);
    runFor(roam, 12);
    const last = h.applied[h.applied.length - 1];
    assert.ok(last && last.x > h.start.x, "expected a rightward walk");
    assert.deepStrictEqual(h.headings, ["R"]);
  });

  it("skips the walk when the lean side has no room, then keeps rescheduling", () => {
    // xMin = round(1920*0.15) = 288; pet at 300 has less than ROAM_MIN_DIST of room on the left.
    const h = makeCtx({ x: 300, lean: -1 });
    const roam = roamModule(h.ctx);
    roam.setEnabled(true);
    runFor(roam, 20);
    assert.strictEqual(h.applied.length, 0, "must not wander the other way");
    assert.deepStrictEqual(h.headings, []);
  });

  it("honours the injected speed knob", () => {
    const slow = makeCtx({ x: 900, lean: -1, speed: 0.03 });
    const fast = makeCtx({ x: 900, lean: -1, speed: 0.3 });
    mock.method(Math, "random", () => 0.5);
    const travelled = (h) => (h.applied.length ? Math.abs(h.applied[h.applied.length - 1].x - h.start.x) : 0);
    // Same wall-clock budget for each: 8 s idle delay + 1 s of walking, on a fresh timer set.
    for (const h of [slow, fast]) {
      mock.timers.reset();
      mock.timers.enable({ apis: ["setTimeout", "Date"] });
      const roam = roamModule(h.ctx); roam.setEnabled(true); runFor(roam, 9);
      roam.setEnabled(false);
    }
    assert.ok(travelled(fast) > travelled(slow), `fast ${travelled(fast)} should outrun slow ${travelled(slow)} after the same time`);
  });
});
