const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createReachyMiniMain } = require("../src/robots/reachy/reachy-mini-main");

const settle = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

function harness(t, { sendThrows = false } = {}) {
  const values = { petRobot: "reachy-mini", reachyAutoConnect: true, reachyHost: "", duckMuted: false, duckVoiceVolume: 0.5 };
  const observers = new Map();
  const settings = { get: key => values[key], subscribeKey(key, callback) {
    if (!observers.has(key)) observers.set(key, new Set());
    observers.get(key).add(callback); return () => observers.get(key).delete(callback);
  } };
  const update = (key, value) => { values[key] = value; for (const fn of observers.get(key) || []) fn(value); };
  const calls = [], renderer = [], handlers = new Map(), ipcMain = new EventEmitter();
  ipcMain.handle = (key, handler) => handlers.set(key, handler);
  ipcMain.removeHandler = key => handlers.delete(key);
  const sender = {};
  const client = new EventEmitter();
  client.generation = 1;
  client.status = { connected: false, state: "offline", motionEnabled: false, url: null };
  client.snapshot = () => ({
    ...client.status,
    sleeping: client.sleptByUs === true && client.status.motionEnabled === false,
    motionState: client.motionState || null,
  });
  client.publish = patch => { Object.assign(client.status, patch); client.emit("status", client.snapshot()); };
  Object.assign(client, {
    start: host => calls.push(["start", host]),
    stop: () => calls.push(["stop"]),
    setVolume: async value => calls.push(["volume", value]),
    stopSound: async () => calls.push(["stopSound"]),
    playSound: async (bytes, key) => { calls.push(["sound", bytes, key]); return { sink: "robot" }; },
    goToSleep: async () => {
      calls.push(["sleep"]); client.sleptByUs = true;
      client.status.motionEnabled = false;
    },
    wakeUp: async () => {
      calls.push(["wake"]);
      client.motionState = "wake_up"; client.publish({});
      client.sleptByUs = false;
      client.publish({ motionEnabled: true, state: "connected" });
      client.motionState = null; client.publish({});
    },
  });
  const connect = (motionEnabled = true) => {
    client.publish({ connected: true, state: motionEnabled ? "connected" : "motors-disabled", motionEnabled, url: "http://robot:8000" });
  };
  const wav = Buffer.alloc(48); wav.writeInt16LE(10000, 44); wav.writeInt16LE(-10000, 46);
  const sendToRenderer = (...args) => {
    if (sendThrows) throw new Error("renderer unavailable");
    renderer.push(args);
  };
  const service = createReachyMiniMain({ ipcMain, settings, getWindow: () => ({ isDestroyed: () => false, webContents: sender }), sendToRenderer, client, readSound: () => wav });
  t.after(() => service.dispose());
  return {
    update, client, calls, renderer, handlers, ipcMain, service, connect,
    invoke: (channel, payload, eventSender = sender) => handlers.get(channel)({ sender: eventSender }, payload),
  };
}

test("main semantic policy selects desktop or robot audio and honors notification mute", async t => {
  const h = harness(t);
  h.service.handleSemanticState("notification", { muteNotificationSound: true });
  await settle();
  assert.equal(h.renderer.some(([channel]) => channel === "reachy-local-sound"), false);

  h.service.handleSemanticState("idle");
  h.service.handleSemanticState("attention");
  await settle();
  assert.deepEqual(h.renderer.filter(([channel]) => channel === "reachy-local-sound").map(([, name]) => name), ["chirp"]);

  h.connect();
  h.service.handleSemanticState("idle");
  h.service.handleSemanticState("error");
  await settle();
  const sound = h.calls.find(call => call[0] === "sound");
  assert.equal(sound[1].readInt16LE(44), 10000);
  assert.equal(sound[1].readInt16LE(46), -10000);

  h.update("duckMuted", true);
  h.service.handleSemanticState("idle");
  h.service.handleSemanticState("attention");
  await settle();
  assert.equal(h.calls.filter(call => call[0] === "sound").length, 1);
  assert.ok(h.calls.some(call => call[0] === "stopSound"));
});

test("connection and renderer reload never replay an old cue", async t => {
  const h = harness(t);
  h.service.handleSemanticState("error", { initial: true });
  h.connect();
  await h.invoke("reachy-status");
  await h.invoke("reachy-status");
  await settle();
  assert.equal(h.calls.some(call => call[0] === "sound"), false);
  assert.equal(h.renderer.some(([channel]) => channel === "reachy-local-sound"), false);
});

test("a semantic click intent reaches the selected output without animation feedback", async t => {
  const h = harness(t);
  assert.equal(h.service.handleIntent({ type: "perform", action: "quack", source: "local" }), true);
  await settle();
  assert.deepEqual(h.renderer.filter(([channel]) => channel === "reachy-local-sound").map(([, name]) => name), ["chirp"]);
  assert.equal(h.service.handleIntent({ type: "move" }), false);
});

test("semantic lifecycle runs without a renderer, deduplicates, and wakes only its own sleep", async t => {
  const h = harness(t, { sendThrows: true });
  h.connect(true);
  h.service.handleSemanticState("sleeping");
  h.service.handleSemanticState("sleeping");
  await settle();
  assert.equal(h.calls.filter(call => call[0] === "sleep").length, 1);

  h.service.handleSemanticState("working");
  await settle();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 1);

  h.client.sleptByUs = false;
  h.client.status.motionEnabled = false;
  h.service.handleSemanticState("idle");
  await settle();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 1, "externally disabled motors stay disabled");
});

test("sleep intent established offline reconciles on connect without replaying history", async t => {
  const h = harness(t);
  h.service.handleSemanticState("sleeping", { initial: true });
  assert.equal(h.calls.some(call => call[0] === "sleep"), false);
  h.connect(true);
  await settle();
  assert.equal(h.calls.filter(call => call[0] === "sleep").length, 1);
  assert.equal(h.renderer.some(([channel]) => channel === "reachy-local-sound"), false);
});

test("explicit wake shares the lifecycle queue and cannot immediately resleep", async t => {
  const h = harness(t);
  h.connect(false);
  h.client.sleptByUs = true;
  h.service.handleSemanticState("sleeping", { initial: true });
  await h.service.wakeUp();
  h.service.handleSemanticState("waking");
  await settle();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 1);
  assert.equal(h.calls.filter(call => call[0] === "sleep").length, 0);
});

test("a notification that wakes the robot cannot overlap the official wake audio", async t => {
  const h = harness(t);
  h.connect(false);
  h.client.sleptByUs = true;
  h.service.handleSemanticState("sleeping", { initial: true });
  let releaseWake;
  h.client.wakeUp = async () => {
    h.calls.push(["wake"]);
    h.client.motionState = "wake_up"; h.client.publish({});
    await new Promise(resolve => { releaseWake = resolve; });
    h.client.sleptByUs = false;
    h.client.publish({ motionEnabled: true, state: "connected" });
    h.client.motionState = null; h.client.publish({});
  };

  h.service.handleSemanticState("notification");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 1);
  assert.equal(h.calls.some(call => call[0] === "sound"), false);
  assert.equal(h.service.handleIntent({ type: "perform", action: "quack", source: "local" }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.some(call => call[0] === "sound"), false, "click cue cannot bypass lifecycle audio ownership");
  releaseWake();
  await settle();
  assert.equal(h.calls.some(call => call[0] === "sound"), false, "transient cue is not replayed after wake");
});

test("an uncertain lifecycle failure is not retried by its own status cleanup", async t => {
  const h = harness(t);
  h.connect(true);
  h.client.goToSleep = async () => {
    h.calls.push(["sleep"]);
    h.client.motionState = "goto_sleep"; h.client.publish({});
    h.client.motionState = null; h.client.publish({});
    throw new Error("uncertain acknowledgement");
  };
  h.service.handleSemanticState("sleeping");
  await settle(); await settle();
  assert.equal(h.calls.filter(call => call[0] === "sleep").length, 1);
});

test("a lifecycle failure is recorded once and cleared by the next completed action", async t => {
  const h = harness(t);
  h.connect(true);
  h.client.goToSleep = async () => { h.calls.push(["sleep"]); throw new Error("sleep refused"); };
  h.service.handleSemanticState("sleeping");
  await settle(); await settle();
  assert.equal(h.client.snapshot().motionError, "sleep refused");

  h.client.sleptByUs = true;
  h.client.status.motionEnabled = false;
  h.service.handleSemanticState("idle");
  await settle(); await settle();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 1);
  assert.equal(h.client.snapshot().motionError, null, "a completed action clears the stale error");
});

test("an explicit wake only moves a robot that actually needs waking", async t => {
  const h = harness(t);
  h.connect(true);
  await h.service.wakeUp();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 0, "an awake robot is not woken again");

  h.client.publish({ motionEnabled: false, state: "motors-disabled" });
  await h.service.wakeUp();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 1, "disabled motors still wake");

  h.client.sleptByUs = true;
  h.client.status.motionEnabled = false;
  await h.service.wakeUp();
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 2, "a sleep we performed still wakes");
});

test("a host switch cancels a cue before bytes can reach the new robot", async t => {
  const h = harness(t);
  h.connect(true);
  let release;
  h.client.setVolume = () => new Promise(resolve => { release = resolve; });
  h.service.handleSemanticState("error");
  await new Promise(resolve => setImmediate(resolve));
  h.update("reachyHost", "other-reachy.local:8000");
  release();
  await settle();
  assert.equal(h.calls.some(call => call[0] === "sound"), false);
});

test("a queued explicit wake cannot target a replacement connection", async t => {
  const h = harness(t);
  h.connect(true);
  let releaseSleep;
  h.client.goToSleep = () => new Promise(resolve => {
    h.calls.push(["sleep"]);
    releaseSleep = resolve;
  });
  h.service.handleSemanticState("sleeping");
  await new Promise(resolve => setImmediate(resolve));
  const wake = h.service.wakeUp();
  h.client.generation++;
  h.update("reachyHost", "replacement.local:8000");
  releaseSleep();
  await wake;
  assert.equal(h.calls.filter(call => call[0] === "wake").length, 0);
});

test("renderer IPC is read-only, and shared pet prefs are not this adapter's to own", async t => {
  const h = harness(t);
  assert.equal((await h.invoke("reachy-status")).connected, false);
  assert.equal(await h.invoke("reachy-status", null, {}), null, "only the pet window may read the robot");
  // Both robots re-read the prefs on reload, so the handler lives in main's pet
  // wiring; owning it here would remove it whenever this adapter is disposed.
  assert.equal(h.handlers.has("pet-runtime-config"), false);
  assert.equal(h.handlers.has("reachy-sound"), false);
  assert.equal(h.ipcMain.listenerCount("reachy-state"), 0);
});

test("a throttled status burst still delivers its last frame", async t => {
  const h = harness(t);
  const statuses = () => h.renderer.filter(([channel]) => channel === "reachy-status");
  h.connect(true);
  h.client.publish({ motionEnabled: false, state: "motors-disabled" });
  assert.equal(statuses().length, 1, "a second status 1 ms later is throttled");
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(statuses().length, 2, "the dropped status is flushed, not lost");
  assert.equal(statuses().at(-1)[1].motionEnabled, false);
});

test("switching robot backends stops discovery and suppresses Reachy policy effects", async t => {
  const h = harness(t);
  assert.ok(h.calls.some(call => call[0] === "start" && call[1] === ""));
  h.update("petRobot", "duck");
  assert.deepEqual(h.calls.at(-1), ["stop"]);
  h.service.handleSemanticState("attention");
  await settle();
  assert.equal(h.renderer.some(([channel]) => channel === "reachy-local-sound"), false);
  h.update("petRobot", "reachy-mini");
  h.update("reachyHost", "reachy-mini.local:8001");
  assert.deepEqual(h.calls.at(-1), ["start", "reachy-mini.local:8001"]);
});

test("an entry expression voices the event instead of the desktop cue, and the cue returns when expressions are off", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const h = harness(t);
  Object.assign(h.client, {
    listRecordedMoves: async () => ["surprised1", "oops2", "enthusiastic1"],
    playRecordedMove: async (dataset, name) => { h.calls.push(["expression", name]); },
  });
  h.connect();
  await settle();
  t.mock.timers.tick(6000);
  h.service.handleSemanticState("idle");
  h.service.handleSemanticState("notification");
  await settle();
  assert.deepEqual(h.calls.filter(c => c[0] === "expression").map(c => c[1]), ["surprised1"]);
  assert.equal(h.calls.some(c => c[0] === "sound"), false, "surprised1 carries its own official sound; no chirp on top");

  h.update("reachyExpressions", false);
  t.mock.timers.tick(10000);
  h.service.handleSemanticState("idle");
  h.service.handleSemanticState("notification");
  await settle();
  assert.equal(h.calls.filter(c => c[0] === "expression").length, 1, "expressions off: no new move");
  assert.equal(h.calls.some(c => c[0] === "sound"), true, "the desktop cue is back");
});
