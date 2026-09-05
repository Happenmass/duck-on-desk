const test = require("node:test");
const assert = require("node:assert/strict");

function fakeApi() {
  const handlers = {};
  const sent = [];
  const on = (name) => (cb) => { handlers[name] = cb; };
  return {
    handlers, sent,
    onStateChange: on("state"), onEyeMove: on("eye"), onDndChange: on("dnd"), onStartDragReaction: on("dragStart"),
    onEndDragReaction: on("dragEnd"), onPlayClickReaction: on("click"), onWakeFromDoze: on("wake"), onThemeConfig: on("theme"),
    onPlaySound: on("sound"), onPreloadSounds: on("preload"), onInvalidateSoundCache: on("inval"), onDuckAppearanceChange: on("skin"), onDuckLift: on("lift"),
    notifyPetVisualReady: () => sent.push(["ready"]),
    notifyPetVisualSettled: (p) => sent.push(["settled", p]),
  };
}

test("bridge settles every visual request on the duck3d channel", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const applied = [];
  const behaviours = { apply: (f) => applied.push(f), eye: () => {}, dispose: () => {} };
  const runtime = { command: () => ({}) };
  connectPetBridge({ api, runtime, behaviours, audio: { setAppearance() {} } });
  assert.deepEqual(api.sent[0], ["ready"]);
  api.handlers.state({ themeId: "duck", logicalState: "working", displayState: "working", file: "duck-working", source: "state", visualGeneration: 7 });
  assert.deepEqual(applied, ["duck-working"]);
  assert.deepEqual(api.sent[1], ["settled", { themeId: "duck", displayState: "working", requestedFile: "duck-working", actualFile: "duck-working", channel: "duck3d", verified: true, visualGeneration: 7, outcome: "swapped" }]);
  api.handlers.state("idle", "duck-idle");
  assert.deepEqual(applied.at(-1), "duck-idle");
  assert.equal(api.sent.at(-1)[1].visualGeneration, null);
});

test("drag and click reactions become grab and quack intents", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const commands = [];
  connectPetBridge({ api, runtime: { command: (i) => commands.push(i) }, behaviours: { apply() {}, eye() {}, dispose() {} }, audio: { setAppearance() {} } });
  api.handlers.dragStart({}); api.handlers.dragEnd(); api.handlers.click({}, 400);
  assert.deepEqual(commands.map((c) => c.type + (c.action ? ":" + c.action : "")), ["perform:quack"]);
});

test("middle-button lift: press holds, upward travel lifts 1 m per 250 px, release drops", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const commands = [];
  connectPetBridge({ api, runtime: { command: (i) => commands.push(i) }, behaviours: { apply() {}, eye() {}, dispose() {} }, audio: { setAppearance() {} } });
  api.handlers.lift({ phase: "end", dy: 0 });                 // release before any press: ignored
  api.handlers.lift({ phase: "start", dy: 0 });
  api.handlers.lift({ phase: "start", dy: 0 });               // repeated start: ignored
  api.handlers.lift({ phase: "move", dy: -200 });             // 200 px up -> 0.8 m
  api.handlers.lift({ phase: "move", dy: 50 });               // below the start point -> on the ground
  api.handlers.lift({ phase: "move", dy: -900 });             // 900 px up -> 3.6 m (not bounded by the window)
  api.handlers.lift({ phase: "move", dy: -9999 });            // capped at 5 m
  api.handlers.lift({ phase: "end", dy: 0 });
  api.handlers.lift({ phase: "end", dy: 0 });
  assert.deepEqual(commands.map((c) => c.type), ["grab-start", "grab-lift", "grab-lift", "grab-lift", "grab-lift", "grab-end"]);
  assert.deepEqual(commands.filter((c) => c.type === "grab-lift").map((c) => +c.height.toFixed(3)), [0.8, 0, 3.6, 5]);
});

test("roam: the duck's stride is reported to main only while roaming", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const reported = [];
  api.reportDuckDisplacement = (d) => reported.push(d);
  let current = "duck-idle";
  let stride = { dx: -4, dy: 1 };
  const runtime = { command: () => ({}), takeDisplacement: () => stride };
  const bridge = connectPetBridge({ api, runtime, behaviours: { apply() {}, eye() {}, dispose() {}, current: () => current }, audio: { setAppearance() {} } });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(reported, [], "idle strides are drained, not reported");
  current = "duck-roam";
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(reported.length >= 1 && reported.every((d) => d.dx === -4 && d.dy === 1));
  stride = { dx: 0, dy: 0 };
  const n = reported.length;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(reported.length, n, "zero strides are not reported");
  bridge.dispose();
});
