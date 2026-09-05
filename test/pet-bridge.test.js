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

test("middle-button lift: pin on enlarge, carry with the pointer, fall with gravity, report and un-pin", async () => {
  const { connectPetBridge } = await import("../renderer/src/pet-bridge.js");
  const api = fakeApi();
  const commands = [];
  const landed = [];
  api.reportDuckLanded = (p) => landed.push(p);
  const stage = { style: { cssText: "" } };
  let view = { width: 184, height: 184 };
  let resize = null;
  const frames = [];
  let t = 1000;
  connectPetBridge({
    api, runtime: { command: (i) => commands.push(i) }, behaviours: { apply() {}, eye() {}, dispose() {} }, audio: { setAppearance() {} },
    stage, viewport: () => view, raf: (fn) => frames.push(fn), now: () => t, onResize: (fn) => { resize = fn; },
  });
  api.handlers.lift({ phase: "end" });                                  // release before any press: ignored
  api.handlers.lift({ phase: "start", x: 1400, y: 675, width: 184, height: 184, floor: 1055, right: 1820 });
  api.handlers.lift({ phase: "start", x: 0, y: 0, width: 184, height: 184, floor: 1055, right: 1820 }); // repeated: ignored
  assert.deepEqual(commands.map((c) => c.type), ["grab-start"]);
  assert.equal(stage.style.left, undefined, "not pinned until the window has grown");
  view = { width: 1820, height: 1055 };
  resize();
  assert.equal(stage.style.inset, "auto");
  assert.deepEqual([stage.style.left, stage.style.top, stage.style.width], ["1400px", "675px", "184px"]);
  api.handlers.lift({ phase: "move", dx: -300, dy: -400 });
  assert.deepEqual([stage.style.left, stage.style.top], ["1100px", "275px"]);
  api.handlers.lift({ phase: "move", dx: -9999, dy: -9999 });           // clamped to the page
  assert.deepEqual([stage.style.left, stage.style.top], ["0px", "0px"]);
  api.handlers.lift({ phase: "move", dx: -300, dy: -400 });
  api.handlers.lift({ phase: "end" });
  assert.equal(frames.length, 1, "the fall runs on animation frames");
  let steps = 0;
  while (frames.length && steps < 200) { const fn = frames.shift(); t += 16; fn(t); steps++; }
  assert.ok(steps > 10 && steps < 60, `fell for ${steps} frames`);
  assert.equal(stage.style.top, `${1055 - 184}px`, "rests on the work-area bottom");
  assert.deepEqual(commands.map((c) => c.type), ["grab-start", "grab-end"]);
  assert.deepEqual(landed, [{ x: 1100, y: 1055 - 184 }]);
  api.handlers.lift({ phase: "reset" });
  assert.equal(stage.style.left, "1100px", "stays pinned while the window is still large");
  view = { width: 184, height: 184 };
  resize();
  assert.equal(stage.style.cssText, "", "un-pinned once the window is small again");
  api.handlers.lift({ phase: "start", x: 0, y: 0, width: 184, height: 184, floor: 1055, right: 1820 });
  assert.equal(commands.length, 3, "a new press is accepted after the drop");
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
