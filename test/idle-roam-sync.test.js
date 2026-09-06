const test = require("node:test");
const assert = require("node:assert/strict");

test("idle never leases walking outside main's roam state; roam still walks", async (t) => {
  const { AutonomyAdapter } = await import("../renderer/src/adapters/autonomy-adapter.js");
  const { createBehaviours } = await import("../renderer/src/agent-visual-adapter.js");
  t.mock.timers.enable({ apis: ["setInterval"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  let roll = 0;
  t.mock.method(Math, "random", () => roll);
  const commands = [];
  const runtime = {
    command: (c) => commands.push(c),
    snapshot: () => ({ mode: "walk", busy: false, sleeping: false, facing: 0.3 }),
  };
  const autonomy = new AutonomyAdapter(runtime);
  const behaviours = createBehaviours({ runtime, autonomy });
  t.after(() => { behaviours.dispose(); autonomy.dispose(); });
  // Exercise every part of the random repertoire through its real timer.
  for (roll = 0; roll < 1; roll += 0.05) {
    behaviours.apply("duck-idle");
    now += 30_000;
    t.mock.timers.tick(750);
  }
  assert.deepEqual(commands.filter((c) => c.type === "move"), [],
    "idle gait would be discarded by the bridge instead of moving the window");
  behaviours.apply("duck-roam");
  assert.equal(commands.at(-1).type, "move");
  behaviours.apply("duck-idle");
  assert.equal(commands.at(-1).type, "stop");
});
