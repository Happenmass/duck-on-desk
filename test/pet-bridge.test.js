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
    onPlaySound: on("sound"), onPreloadSounds: on("preload"), onInvalidateSoundCache: on("inval"), onDuckAppearanceChange: on("skin"),
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
  assert.deepEqual(commands.map((c) => c.type + (c.action ? ":" + c.action : "")), ["grab-start", "grab-end", "perform:quack"]);
});
