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

describe("roam follows the duck's stride (duckDrivesRoam)", () => {
  beforeEach(() => { mock.timers.enable({ apis: ["setTimeout", "Date"] }); });
  afterEach(() => { mock.timers.reset(); mock.restoreAll(); });

  function startWalk(extra = {}) {
    const h = makeCtx({ x: 900, lean: -1 });
    h.ctx.duckDrivesRoam = true;
    Object.assign(h.ctx, extra);
    const roam = roamModule(h.ctx);
    roam.setEnabled(true);
    runFor(roam, 9); // idle delay elapses, the walk is armed
    assert.equal(h.ctx.getCurrentState(), "roam");
    return { h, roam };
  }

  it("turns toward available space without relying on an idle autonomy sweep", () => {
    for (const [x, lean, heading] of [[300, -1, "R"], [1500, 1, "L"]]) {
      const h = makeCtx({ x, lean });
      h.ctx.duckDrivesRoam = true;
      const roam = roamModule(h.ctx);
      roam.setEnabled(true);
      runFor(roam, 9);
      assert.equal(h.ctx.getCurrentState(), "roam");
      assert.deepStrictEqual(h.headings, [heading]);
      roam.setEnabled(false);
    }
  });

  it("moves the window by exactly the reported stride and ignores its own tween", () => {
    const { h, roam } = startWalk();
    mock.timers.tick(500);
    assert.deepStrictEqual(h.applied.at(-1), { x: 900, y: 400 }, "no stride reported → window stays put");
    roam.onDisplacement(-3, 1);
    mock.timers.tick(16);
    assert.equal(h.applied.at(-1).x, 897);
    roam.onDisplacement(-2.5, -0.5);
    roam.onDisplacement(-1.5, 0);
    mock.timers.tick(16);
    assert.equal(h.applied.at(-1).x, 893);
    // The stride's own vertical component is ignored: y follows the planned
    // drift in proportion to the lateral travel (≤ 60% of it), never the
    // reported dy.
    const dy = Math.abs(h.applied.at(-1).y - 400);
    assert.ok(dy <= Math.ceil(7 * 0.6) + 1, `vertical ${dy} for 7 px lateral`);
    assert.equal(h.ctx.getCurrentState(), "roam");
  });

  it("ends the walk once the planned distance is covered", () => {
    const { h, roam } = startWalk();
    for (let i = 0; i < 400 && h.ctx.getCurrentState() === "roam"; i++) { roam.onDisplacement(-2, 0); mock.timers.tick(16); }
    assert.equal(h.ctx.getCurrentState(), "idle");
    const dx = h.start.x - h.applied.at(-1).x;
    assert.ok(dx >= 100 && dx <= 700, `walked ${dx}px`);
  });

  it("ends the walk when the stride is blocked at the screen edge", () => {
    const { h, roam } = startWalk({ clampToScreenVisual: (cx, cy, w, h2) => ({ x: Math.max(890, cx), y: cy, width: w, height: h2 }) });
    for (let i = 0; i < 80 && h.ctx.getCurrentState() === "roam"; i++) { roam.onDisplacement(-2, 0); mock.timers.tick(16); }
    assert.equal(h.ctx.getCurrentState(), "idle");
    assert.equal(h.applied.at(-1).x, 890);
  });

  it("drops strides reported while no walk is running", () => {
    const h = makeCtx({ x: 900, lean: -1 });
    h.ctx.duckDrivesRoam = true;
    const roam = roamModule(h.ctx);
    roam.onDisplacement(-50, 0);
    roam.setEnabled(true);
    runFor(roam, 9);
    mock.timers.tick(16);
    assert.deepStrictEqual(h.applied.at(-1), { x: 900, y: 400 });
  });

  it("stops at the edge with real 40ms IPC gaps between 16ms frames", () => {
    // Run recursive timeouts at their individual deadlines, including empty
    // frames between reports (coalescing timers would hide this race).
    mock.timers.reset();
    let now = 1000;
    let id = 0;
    const timers = new Map();
    mock.method(Date, "now", () => now);
    mock.method(global, "setTimeout", (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; });
    mock.method(global, "clearTimeout", (key) => timers.delete(key));
    mock.method(Math, "random", () => 0.5);
    function advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    }
    const h = makeCtx({ x: 900, lean: -1 });
    Object.assign(h.ctx, { duckDrivesRoam: true,
      clampToScreenVisual: (x, y, w, h) => ({ x: Math.min(910, x), y: 400, width: w, height: h }) });
    const roam = roamModule(h.ctx);
    roam.setEnabled(true);
    roam.tick();
    advance(8000);
    assert.equal(h.ctx.getCurrentState(), "roam");
    for (let ms = 0; ms < 1600 && h.ctx.getCurrentState() === "roam"; ms += 8) {
      if (ms % 40 === 0) roam.onDisplacement(2, 0);
      advance(8);
    }
    assert.equal(h.applied.at(-1).x, 910);
    assert.equal(h.ctx.getCurrentState(), "idle", "blocked duck must stop walking even between IPC samples");
  });
});
