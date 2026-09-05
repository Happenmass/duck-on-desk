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
    onDuckMutedChange: on("muted"), onDuckVolumeChange: on("volume"), onDuckStiltsChange: on("stilts"),
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

test("middle-button lift: rise -> height at main's px/m, release -> fall streamed until landed", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const commands = [];
  const falls = [];
  const frames = [];
  api.reportDuckFall = (p) => falls.push(p);
  let height = 0.12;
  connectPetBridge({ api, runtime: { command: (i) => commands.push(i), snapshot: () => ({ height }) }, behaviours: { apply() {}, eye() {}, dispose() {} }, audio: { setAppearance() {} }, raf: (fn) => frames.push(fn) });
  api.handlers.lift({ phase: "end" });                        // release before any press: ignored
  api.handlers.lift({ phase: "start", pxPerMetre: 200 });
  api.handlers.lift({ phase: "start", pxPerMetre: 200 });     // repeated start: ignored
  api.handlers.lift({ phase: "move", dy: -100 });             // window 100 px above the pick-up spot -> 0.5 m
  api.handlers.lift({ phase: "move", dy: 30 });               // below it -> on the ground
  api.handlers.lift({ phase: "move", dy: -9999 });            // capped at 5 m
  api.handlers.lift({ phase: "end" });
  assert.deepEqual(commands.map((c) => c.type), ["grab-start", "grab-lift", "grab-lift", "grab-lift", "grab-end"]);
  assert.deepEqual(commands.filter((c) => c.type === "grab-lift").map((c) => +c.height.toFixed(3)), [0.5, 0, 5]);
  // The fall: heights stream every frame until three calm frames on the ground.
  const drop = [1.32, 1.0, 0.6, 0.2, 0.13, 0.125, 0.12, 0.118];
  let i = 0;
  while (frames.length) { height = drop[Math.min(i++, drop.length - 1)]; frames.shift()(); }
  assert.deepEqual(falls.map((f) => [+f.height.toFixed(2), f.done]), [[1.2, false], [0.88, false], [0.48, false], [0.08, false], [0.01, false], [0.01, false], [0, true]]);
  api.handlers.lift({ phase: "start" });
  assert.equal(commands.at(-1).type, "grab-start", "a new press is accepted after the drop");
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

test("mute and per-bus volume settings are handed to the audio adapter", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const audioCalls = [];
  connectPetBridge({ api, runtime: { command: () => ({}) }, behaviours: { apply() {}, eye() {}, dispose() {} }, audio: { setAppearance() {}, setMuted: (m) => audioCalls.push(["muted", m]), setVolumes: (v) => audioCalls.push(["volumes", v]) } });
  api.handlers.muted(true);
  api.handlers.volume({ steps: 0.25 });
  assert.deepEqual(audioCalls, [["muted", true], ["volumes", { steps: 0.25 }]]);
});

test("a stilts setting change becomes a runtime morphology command", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const commands = [];
  connectPetBridge({ api, runtime: { command: (i) => commands.push(i) }, behaviours: { apply() {}, eye() {}, dispose() {} }, audio: { setAppearance() {} } });
  api.handlers.stilts(25);
  assert.deepEqual(commands, [{ type: "stilts", heightCm: 25, source: "local" }]);
});
