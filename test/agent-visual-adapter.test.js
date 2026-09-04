const test = require("node:test");
const assert = require("node:assert/strict");

test("planForVisual maps every duck intent id to a behaviour", async () => {
  const { planForVisual, INTENT_IDS } = await import("../renderer/src/agent-visual-adapter.js");
  assert.deepEqual([...INTENT_IDS].sort(), ["duck-attention", "duck-carrying", "duck-error", "duck-idle", "duck-juggling",
    "duck-notification", "duck-sleeping", "duck-sweeping", "duck-thinking", "duck-waking", "duck-working"]);
  assert.deepEqual(planForVisual("duck-idle"), { kind: "idle" });
  assert.deepEqual(planForVisual("duck-working"), { kind: "walk", forward: 0.7, heading: 0, periodMs: 2000 });
  assert.deepEqual(planForVisual("duck-juggling"), { kind: "sweep", forward: 0.8, amplitude: 0.8, periodMs: 3000 });
  assert.deepEqual(planForVisual("duck-notification"), { kind: "face", quackEveryMs: 2500 });
  assert.deepEqual(planForVisual("duck-attention"), { kind: "face", quackEveryMs: 0 });
  assert.deepEqual(planForVisual("duck-sweeping"), { kind: "peck", everyMs: 4000 });
  assert.deepEqual(planForVisual("duck-carrying"), { kind: "peck", everyMs: 0 });
  assert.deepEqual(planForVisual("duck-error"), { kind: "sulk" });
  assert.deepEqual(planForVisual("duck-sleeping"), { kind: "sleep" });
  assert.deepEqual(planForVisual("duck-waking"), { kind: "wake" });
  assert.deepEqual(planForVisual("unknown.svg"), { kind: "idle" });
});

test("createBehaviours issues runtime commands and clears timers on change", async () => {
  const { createBehaviours } = await import("../renderer/src/agent-visual-adapter.js");
  const commands = [];
  const runtime = { command: (intent) => { commands.push(intent); return {}; }, snapshot: () => ({ facing: 0.3 }) };
  const autonomy = { paused: false, pause() { this.paused = true; }, resume() { this.paused = false; } };
  const timers = new Map(); let nextId = 1;
  const clock = {
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => timers.delete(id),
  };
  const b = createBehaviours({ runtime, autonomy, clock });
  b.apply("duck-working");
  assert.equal(autonomy.paused, true);
  assert.deepEqual(commands.at(-1), { type: "move", source: "system", forward: 0.7, heading: 0, ttlMs: 2600 });
  assert.equal(timers.size, 1);
  b.apply("duck-notification");
  assert.equal(timers.size, 1);
  assert.ok(commands.some((c) => c.type === "perform" && c.action === "quack"));
  b.apply("duck-idle");
  assert.equal(autonomy.paused, false);
  assert.equal(timers.size, 0);
  assert.deepEqual(commands.at(-1), { type: "stop", source: "system" });
});

test("returning to idle stands the duck up or wakes it before resuming autonomy", async () => {
  const { createBehaviours } = await import("../renderer/src/agent-visual-adapter.js");
  const clock = { setInterval: () => 1, clearInterval: () => {} };
  const autonomy = { pause() {}, resume() {} };
  const run = (snapshot) => {
    const commands = [];
    const b = createBehaviours({ runtime: { command: (i) => commands.push(i), snapshot: () => snapshot }, autonomy, clock });
    b.apply("duck-idle");
    return commands.map((c) => c.type + (c.action ? ":" + c.action : ""));
  };
  assert.deepEqual(run({ mode: "sit", sleeping: false }), ["perform:stand", "stop"]);
  assert.deepEqual(run({ mode: "sit", sleeping: true }), ["wake", "stop"]);
  assert.deepEqual(run({ mode: "walk", sleeping: false }), ["stop"]);
});
