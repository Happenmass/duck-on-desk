"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { WebSocketServer } = require("ws");
const { ReachyMiniClient, daemonUrl, robotVolumePercent } = require("../src/robots/reachy/reachy-mini-client");

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const pose = () => ({ head: [...identity], antennas: [0.1, -0.1], body_yaw: 0 });
// Poses are avatar-only now; the 3D rig still needs finite rigid transforms.
const rigid = p => p.head.every(Number.isFinite) && p.antennas.every(Number.isFinite) && Number.isFinite(p.body_yaw)
  && [0, 4, 8].every(i => Math.abs(Math.hypot(p.head[i], p.head[i + 1], p.head[i + 2]) - 1) < 0.002)
  && Math.abs(p.head[0] * p.head[4] + p.head[1] * p.head[5] + p.head[2] * p.head[6]) < 0.002;
const waitFor = async predicate => {
  const end = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Timed out waiting for Reachy protocol state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

async function robotServer(t, { motors = "enabled", simulated = false, wakeRaisesHead = false } = {}) {
  const messages = [], requests = [];
  let failAudio = false, volume = 100;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: Buffer.concat(chunks) });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/daemon/status") return res.end(JSON.stringify({ state: "running", robot_name: "Test Reachy", simulation_enabled: simulated, backend_status: { motor_control_mode: motors } }));
    if (req.url === "/api/volume/current") return res.end(JSON.stringify({volume}));
    if (req.url === "/api/move/play/goto_sleep") { motors = "disabled"; return res.end(JSON.stringify({uuid:"sleep-fixture"})); }
    if (req.url === "/api/move/play/wake_up") {
      // Optionally behave like the real daemon: the official wake raises the head.
      for (const socket of wakeRaisesHead ? wss.clients : []) {
        socket.send(JSON.stringify({ type: "head_pose", head_pose: [identity.slice(0, 4), identity.slice(4, 8), identity.slice(8, 12), identity.slice(12)] }));
        socket.send(JSON.stringify({ type: "joint_positions", head_joint_positions: [0, 0, 0, 0, 0, 0, 0], antennas_joint_positions: [-0.1745, 0.1745] }));
      }
      return res.end(JSON.stringify({uuid:"wake-fixture"}));
    }
    if (req.url === "/api/move/running") return res.end("[]");
    if (req.url === "/api/motors/set_mode/enabled") motors = "enabled";
    if (req.url === "/api/motors/set_mode/disabled") motors = "disabled";
    if (req.url === "/api/motors/status") return res.end(JSON.stringify({ mode: motors }));
    if (req.url.includes("play_sound") && failAudio) { res.statusCode = 503; return res.end("{}"); }
    res.end('{"status":"ok"}');
  });
  const wss = new WebSocketServer({ server, path: "/ws/sdk" });
  wss.on("connection", socket => {
    socket.on("message", bytes => { const m=JSON.parse(String(bytes)); messages.push(m); if(m.type === "set_volume") volume=m.volume; });
    socket.send(JSON.stringify({ type: "head_pose", head_pose: [identity.slice(0, 4), identity.slice(4, 8), identity.slice(8, 12), identity.slice(12)] }));
    socket.send(JSON.stringify({ type: "joint_positions", head_joint_positions: [0, 0, 0, 0, 0, 0, 0], antennas_joint_positions: [0.1, -0.1] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new ReachyMiniClient({ discover: () => () => {} });
  t.after(async () => { client.stop(); for (const socket of wss.clients) socket.terminate(); wss.close(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { client, url, messages, requests, wss, setFailAudio: value => { failAudio = value; } };
}

test("LAN addresses normalize without credentials or arbitrary paths", () => {
  assert.equal(daemonUrl("reachy-mini.local"), "http://reachy-mini.local:8000");
  assert.equal(daemonUrl("192.168.1.10:8001"), "http://192.168.1.10:8001");
  for (const input of ["http://user:password@robot", "file:///tmp/robot", "http://robot/path", "http://robot?token=x"]) assert.equal(daemonUrl(input), null);
});

test("real HTTP + WS handshake, feedback, motion, disconnect and reconnect", async t => {
  const r = await robotServer(t);
  assert.deepEqual(await r.client.playSound(Buffer.alloc(4), "test"), { sink: "desktop" });
  r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  assert.deepEqual(r.client.snapshot().pose, pose());
  assert.deepEqual(r.messages, [], "renderer cannot stream physical targets");
  const firstGeneration = r.client.generation;
  r.client.sleptByUs = true;
  r.client.status.motionEnabled = false;
  assert.equal(r.client.snapshot().sleeping, true);
  for (const socket of r.wss.clients) socket.terminate();
  await waitFor(() => !r.client.snapshot().connected);
  assert.ok(r.client.generation > firstGeneration, "disconnect starts a new physical connection generation");
  assert.equal(r.client.snapshot().sleeping, false, "disconnect clears sleep ownership");
  await r.client.probe(); await waitFor(() => r.client.snapshot().connected);
  assert.equal(r.client.snapshot().url, r.url);
  assert.equal(r.client.snapshot().sleeping, false, "same-URL reconnect cannot inherit sleep ownership");
});

test("online audio uploads once; remote failures never duplicate audio on desktop", async t => {
  const r = await robotServer(t); r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  assert.equal((await r.client.playSound(Buffer.from("fixture"), "chirp")).sink, "robot");
  assert.equal((await r.client.playSound(Buffer.from("fixture"), "chirp")).sink, "robot");
  assert.equal(r.requests.filter(r => r.url === "/api/media/sounds/upload").length, 1);
  r.setFailAudio(true);
  assert.deepEqual(await r.client.playSound(Buffer.alloc(4), "chirp"), { sink: "robot", error: true });
});

test("disabled motors are mirrored but never enabled or driven by the pet", async t => {
  const r = await robotServer(t, { motors: "disabled" }); r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  assert.equal(r.client.snapshot().state, "motors-disabled");
  assert.deepEqual(r.messages, []);
});

test("the client offers the renderer no way to send a physical pose", () => {
  const client = new ReachyMiniClient();
  const surface = [...Object.getOwnPropertyNames(ReachyMiniClient.prototype), ...Object.keys(client)];
  assert.deepEqual(surface.filter(name => /pose/i.test(name)), ["pose"], "only the read-only feedback field mentions poses");
});

test("snapshot separates confirmed sleep, active motion, and disconnected state", () => {
  const client = new ReachyMiniClient();
  client.status = { connected: true, state: "connected", motionEnabled: true, url: "http://robot:8000" };
  client.motionAction = "goto_sleep";
  assert.equal(client.snapshot().sleeping, false);
  assert.equal(client.snapshot().motionState, "goto_sleep");
  assert.equal(client.snapshot().waking, false);

  client.motionAction = null;
  client.sleptByUs = true;
  client.status.motionEnabled = false;
  assert.equal(client.snapshot().sleeping, true);
  const generation = client.generation;
  client.disconnect("offline");
  assert.equal(client.generation, generation + 1);
  assert.equal(client.snapshot().sleeping, false);
  assert.equal(client.snapshot().motionState, null);
});

test("simulator discovery does not steal the physical audio output", async t => {
  const r = await robotServer(t, { simulated: true });
  r.client.enabled = true; r.client.candidates.add(r.url); await r.client.probe();
  assert.equal(r.client.snapshot().connected, false);
});

test("stopping during discovery cannot resurrect a late robot connection", async () => {
  let resolve;
  const client = new ReachyMiniClient({ fetchImpl: () => new Promise(r => { resolve = r; }) });
  client.enabled = true; client.candidates.add("http://robot:8000");
  const pending = client.probe(); client.stop();
  resolve({ ok: true, json: async () => ({ state: "running", robot_name: "Late" }) });
  await pending; assert.equal(client.socket, null); assert.equal(client.snapshot().connected, false);
});

test("mute during upload cancels pending physical playback", async () => {
  let release;
  const paths = [];
  const client = new ReachyMiniClient({ fetchImpl: async url => {
    paths.push(url);
    if (url.includes("upload")) await new Promise(r => { release = r; });
    return { ok: true, json: async () => ({ status: "ok" }) };
  } });
  client.status = { connected: true, url: "http://robot:8000" };
  const pending = client.playSound(Buffer.alloc(4), "test");
  await client.stopSound(); release();
  assert.deepEqual(await pending, { sink: "robot", cancelled: true });
  assert.ok(!paths.some(p => p.includes("play_sound")));
});

test("procedural expressions are bounded, valid robot-frame rotations", async () => {
  const { sampleReachyMotion, blendPose, neutralPose } = await import("../renderer/src/runtime/reachy-motion.js");
  for (const file of ["duck-idle", "duck-thinking", "duck-working", "duck-attention", "duck-error", "duck-sleeping"]) {
    let prev = neutralPose();
    for (let i = 0; i < 300; i++) {
      const next = sampleReachyMotion(file, i / 25, { yaw: 0.2, pitch: 0.12 });
      assert.ok(rigid(next), file);
      assert.ok(Math.abs(next.head[11]) < 0.06 && Math.abs(next.body_yaw) < 0.7, file);
      prev = blendPose(prev, next, 0.1); assert.ok(rigid(prev));
    }
  }
});

test("virtual sleep folds to the SDK rest pose", async () => {
  const { sampleReachyMotion } = await import("../renderer/src/runtime/reachy-motion.js");
  const sleep = sampleReachyMotion("duck-sleeping", 0);
  assert.equal(sleep.head[11], -0.044);
  assert.equal(sleep.head[3], -0.021);
  assert.deepEqual(sleep.antennas, [-3.05, 3.05]);
  assert.deepEqual(sampleReachyMotion("duck-sleeping", 30), sleep);
  assert.ok(rigid(sleep));
});

test("virtual sleep/wake reaches its endpoints and ignores connected-state input", async () => {
  const { createReachyMotion, neutralPose, sleepPose } = await import("../renderer/src/runtime/reachy-motion.js");
  const motion = createReachyMotion(), mirrored = createReachyMotion();
  let pose = neutralPose(), seconds = 0;
  for (const state of ["duck-thinking", "duck-sleeping", "duck-idle"]) {
    for (let i = 0; i < 200; i++) {
      pose = motion.step(state, seconds += 0.04, 0.04);
      // A connected renderer has nothing to hand back: the old feedback argument
      // is gone, and a trailing one is inert. Offline output must be identical.
      assert.deepEqual(mirrored.step(state, seconds, 0.04, {}, pose), pose, `${state} frame ${i}`);
      assert.ok(rigid(pose));
    }
    if (state === "duck-sleeping") {
      assert.ok(Math.abs(pose.head[11] - sleepPose().head[11]) < 0.00001);
      assert.ok(Math.abs(pose.antennas[0] + 3.05) < 0.001);
    }
  }
  assert.ok(Math.abs(pose.head[11]) < 0.004, "wakes out of folded pose");
});

test("waking interrupts descent without a jump or a delayed return to sleep", async () => {
  const { createReachyMotion, neutralPose } = await import("../renderer/src/runtime/reachy-motion.js");
  const motion = createReachyMotion(); let p = neutralPose();
  for (let i = 0; i < 45; i++) p = motion.step("duck-sleeping", i * 0.04, 0.04);
  assert.ok(p.head[11] < -0.005);
  const first = motion.step("duck-waking", 1.84, 0.04);
  assert.ok(Math.abs(first.head[11] - p.head[11]) < 0.001);
  for (let i = 0; i < 100; i++) p = motion.step("duck-waking", 2 + i * 0.04, 0.04);
  assert.ok(Math.abs(p.head[11]) < 0.000001);
  assert.ok(p.antennas.every((v, i) => Math.abs(v - neutralPose().antennas[i]) < 1e-10));
});


test("explicit wake enables motors through the official API without unmanaged sound", async t => {
  const r = await robotServer(t, { motors: "disabled" });
  r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  assert.equal(r.client.snapshot().motionEnabled, false);
  await r.client.enableMotion();
  assert.equal(r.client.snapshot().motionEnabled, true);
  await r.client.enableMotion();
  assert.equal(r.requests.filter(r => r.url === "/api/motors/set_mode/enabled").length, 1);
  assert.ok(!r.requests.some(r => r.url.includes("sound") || r.url.includes("/play/wake_up")));
});

test("a measured sleeping pose still wakes the avatar, and no physical write exists", async () => {
  const { createReachyMotion } = await import("../renderer/src/runtime/reachy-motion.js");
  const { normalizeAntennas } = require("../src/robots/reachy/reachy-mini-client");
  // A real measured sleep: calibration offsets, FK rounding, wrapped left antenna.
  const measured = {head:[0.836040762039288,-0.31249942625879534,0.4515136012357057,-0.02093090746221836,0.2961013826180511,0.9489629656848521,0.10877353384962557,-0.003265754440983179,-0.46245464422366256,0.04249526396007222,0.8859011539539432,-0.04799677722791515,0,0,0,1],antennas:normalizeAntennas([-3.074097498922825,-3.1185829417715083]),body_yaw:0.35281558121369727};
  assert.ok(measured.antennas[1] > 3, "folded left antenna must use its positive branch");
  const m = createReachyMotion(); m.resetPose(measured);
  let pose = measured;
  for (let i = 0; i < 150; i++) pose = m.step("duck-waking", i * 0.04, 0.04);
  assert.ok(rigid(pose));
  assert.ok(Math.abs(pose.head[11]) < 0.001);
  assert.ok(Math.abs(pose.antennas[1] - 0.1745) < 0.01);
  assert.equal(new ReachyMiniClient().sendPose, undefined, "the avatar has no way to command the robot");
});


test("official wake movement verifies physical arrival instead of only enabling torque", async t => {
  const r = await robotServer(t); r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  // Only a robot that is actually asleep is woken; see the redundant-wake test.
  const asleep = () => { r.client.sleptByUs = true; r.client.status.motionEnabled = false; };
  asleep();
  await r.client.wakeUp();
  assert.ok(r.requests.some(r => r.url === "/api/move/play/wake_up"));
  asleep();
  r.client.pose.head[11] = -0.048;
  await assert.rejects(r.client.wakeUp(), /without reaching idle/);
  assert.equal(r.client.snapshot().waking, false);
});



// A robot reachable over HTTP but answering the wrong volume, or not answering
// at all. Nothing here opens a socket to a real device.
const offlineRobot = ({ volume = "mismatch" } = {}) => {
  const calls = [];
  let current = -1;
  const client = new ReachyMiniClient({ discover: () => () => {}, fetchImpl: async (url, options) => {
    calls.push(url.replace("http://robot:8000", ""));
    if (url.includes("/api/volume/current")) {
      if (volume === "hang") return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      return { ok: true, json: async () => ({ volume: volume === "ok" ? current : 999 }) };
    }
    if (url.includes("/api/move/play/")) return { ok: true, json: async () => ({ uuid: "move-fixture" }) };
    if (url.includes("/api/move/running")) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ mode: "disabled" }) };
  } });
  client.status = { connected: true, state: "connected", motionEnabled: true, url: "http://robot:8000" };
  client.socket = { readyState: 1, terminate() {}, send: payload => { const m = JSON.parse(payload); if (m.type === "set_volume") current = m.volume; } };
  return { client, calls };
};

test("volume verification is best effort and never withholds the physical sleep", async () => {
  for (const volume of ["mismatch", "hang"]) {
    const r = offlineRobot({ volume });
    await r.client.goToSleep();
    assert.ok(r.calls.includes("/api/move/play/goto_sleep"), `${volume} volume must not cancel the sleep`);
    assert.equal(r.client.snapshot().sleeping, true, volume);
    r.client.stop();
  }
  const r = offlineRobot();
  for (let i = 0; i < 5; i++) void r.client.setVolume(i / 10).catch(() => {});
  const started = Date.now();
  await r.client.goToSleep();
  const elapsed = Date.now() - started;
  assert.ok(r.calls.includes("/api/move/play/goto_sleep"));
  assert.ok(elapsed < 500, `queued volume writes delayed the sleep by ${elapsed}ms`);
  r.client.stop();
});

test("a redundant wake on an already-awake robot sends no physical command", async () => {
  const r = offlineRobot();
  r.client.pose = { head: [...identity], antennas: [-0.1745, 0.1745], body_yaw: 0 };
  await r.client.wakeUp();
  assert.deepEqual(r.calls, [], "an awake robot standing at its init pose needs no wake movement");
  r.client.stop();
});

test("the wake decision reads the measured pose, not only our own sleep bookkeeping", () => {
  const { needsWake } = require("../src/robots/reachy/reachy-mini-client");
  const idle = { head: [...identity], antennas: [-0.1745, 0.1745], body_yaw: 0 };
  const folded = { ...idle, head: [...identity] };
  folded.head[11] = -0.046;
  assert.equal(needsWake(undefined), false);
  assert.equal(needsWake({ connected: false, motionEnabled: false, sleeping: true }), false, "an absent robot is never woken");
  assert.equal(needsWake({ connected: true, motionEnabled: false, sleeping: false }), true, "disabled motors need the wake");
  assert.equal(needsWake({ connected: true, motionEnabled: true, sleeping: true }), true, "our own sleep needs the wake");
  assert.equal(needsWake({ connected: true, motionEnabled: true, sleeping: false, pose: idle }), false);
  assert.equal(needsWake({ connected: true, motionEnabled: true, sleeping: false, pose: folded }), true, "torqued but still folded");
  assert.equal(needsWake({ connected: true, motionEnabled: true, sleeping: false, pose: null }), false, "no feedback yet is not a reason to move");
});

// The live failure: an enable landed while the wake never ran, so the robot sits
// torqued at the folded sleep pose and `sleptByUs` is false.
test("a robot folded while the daemon reports enabled gets torque cycled once, then the wake", async () => {
  // 2026-09-06: all motors went limp mid-session with the daemon still saying
  // "enabled" and no hardware error flagged; a plain wake_up did nothing.
  let r;
  r = stubbornDaemon({ timesOut: "", mode: () => r.count("POST /api/motors/set_mode/disabled") > r.count("POST /api/motors/set_mode/enabled") ? "disabled" : "enabled" });
  r.client.publish({ motionEnabled: true, state: "connected" });
  r.client.sleptByUs = false;
  r.client.pose.head[11] = -0.046;
  await assert.rejects(r.client.wakeUp(), /Wake ended without reaching idle/, "this stub never raises the head, so arrival still fails honestly");
  assert.deepEqual(r.calls.filter(c => /set_mode|play\/wake_up/.test(c)), ["POST /api/motors/set_mode/disabled", "POST /api/motors/set_mode/enabled", "POST /api/move/play/wake_up"]);
});

test("stale robot errors clear on a later success and never outlive the connection", async () => {
  const r = offlineRobot({ volume: "ok" });
  r.client.publish({ audioError: "Robot audio unavailable" });
  await r.client.setVolume(0.4);
  assert.equal(r.client.snapshot().audioError, null);
  r.client.publish({ audioError: "Robot audio unavailable", motionError: "Sleep ended without disabling motors" });
  r.client.disconnect("offline");
  assert.equal(r.client.snapshot().audioError, null);
  assert.equal(r.client.snapshot().motionError, null);
  r.client.stop();
});

test("mDNS without an IPv4 record still produces a routable candidate", async t => {
  const probed = [];
  let found;
  const client = new ReachyMiniClient({
    discover: callback => { found = callback; return () => {}; },
    fetchImpl: async url => { probed.push(url); return { ok: true, json: async () => ({ state: "stopped" }) }; },
  });
  t.after(() => client.stop());
  client.start("");
  await waitFor(() => !client.probing);
  await found({ host: "reachy-mini.local", port: 8000, addresses: [], referer: { address: "192.168.31.82" } });
  assert.ok(client.candidates.has("http://192.168.31.82:8000"), "the multicast sender supplies the missing A record");
  assert.ok(client.candidates.has("http://reachy-mini.local:8000"), "the name stays a fallback candidate");
  assert.ok(probed.includes("http://192.168.31.82:8000/api/daemon/status"));

  await found({ host: "reachy-mini.local", port: 8000, addresses: ["192.168.31.99"], referer: { address: "10.0.0.1" } });
  assert.ok(client.candidates.has("http://192.168.31.99:8000"));
  assert.equal(client.candidates.has("http://10.0.0.1:8000"), false, "an advertised address wins over the sender");
});

test("official sleep owns folding and motor shutdown, volume uses silent SDK command", async t => {
  const r = await robotServer(t); r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  await r.client.setVolume(0); await r.client.goToSleep();
  assert.ok(r.messages.some(m => m.type === "set_volume" && m.volume === 0));
  assert.ok(r.requests.some(m => m.url === "/api/move/play/goto_sleep"));
  assert.equal(r.client.snapshot().motionEnabled, false);
  assert.ok(!r.requests.some(m => m.url === "/api/volume/set" || m.url === "/api/move/goto"));
});

test("the robot's own volume is read once per connection and handed back only on stop", async t => {
  const r = await robotServer(t);
  r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  assert.equal(r.client.originalVolume, 100, "read before any set_volume of ours can overwrite it");
  await r.client.setVolume(0.2);
  for (const socket of r.wss.clients) socket.terminate();
  await waitFor(() => !r.client.snapshot().connected);
  assert.equal(r.messages.some(m => m.type === "set_volume" && m.volume === 100), false, "a dropped socket is not the end of the session");
  await r.client.probe(); await waitFor(() => r.client.snapshot().connected);
  assert.equal(r.client.originalVolume, 100, "a reconnect must not adopt our own volume as the robot's");
  assert.equal(r.requests.filter(q => q.url === "/api/volume/current").length >= 1, true);
  r.client.stop();
  await waitFor(() => r.messages.some(m => m.type === "set_volume" && m.volume === 100));
});

// AbortSignal.timeout hides the value it was given; record what the client asks
// for instead of waiting out real timeouts. No socket is opened to a device.
const timeoutsOf = async call => {
  const original = AbortSignal.timeout;
  const seen = [];
  AbortSignal.timeout = ms => { seen.push(ms); return original(30000); };
  try { await call(); } catch { /* the timeouts are the subject, not the result */ }
  finally { AbortSignal.timeout = original; }
  return seen;
};

test("each call gets the timeout its physical cost needs", async () => {
  const client = new ReachyMiniClient({ discover: () => () => {}, fetchImpl: async () => ({ ok: true, json: async () => ({ mode: "enabled" }) }) });
  client.status = { connected: true, state: "motors-disabled", motionEnabled: false, url: "http://robot:8000" };
  assert.deepEqual(await timeoutsOf(() => client.request(client.status.url, "/api/motors/status")), [2000], "a small read stays short");
  assert.deepEqual(await timeoutsOf(() => client.enableMotion()), [10000, 10000], "torque-on runs the daemon's homing");
  assert.deepEqual(await timeoutsOf(() => client.playSound(Buffer.alloc(4), "upload-fixture")), [15000, 2000], "only the upload is megabytes over Wi-Fi");
});

// A daemon whose one named call never answers. The timeout is synthesized so
// the test costs nothing; nothing here opens a socket to a real device.
const stubbornDaemon = ({ timesOut, mode = () => "disabled", running = () => [] }) => {
  const calls = [];
  const client = new ReachyMiniClient({ discover: () => () => {}, fetchImpl: async (url, options) => {
    const path = url.replace("http://robot:8000", "");
    calls.push(`${options.method || "GET"} ${path}`);
    if (path === timesOut) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (path === "/api/motors/status") return { ok: true, json: async () => ({ mode: mode() }) };
    if (path === "/api/move/running") return { ok: true, json: async () => running() };
    if (path === "/api/volume/current") return { ok: true, json: async () => ({ volume: 100 }) };
    return { ok: true, json: async () => ({ uuid: "move-fixture" }) };
  } });
  client.status = { connected: true, state: "motors-disabled", motionEnabled: false, url: "http://robot:8000" };
  client.socket = { readyState: 1, send() {}, terminate() {} };
  client.pose = { head: [...identity], antennas: [-0.1745, 0.1745], body_yaw: 0 };
  return { client, calls, count: call => calls.filter(c => c === call).length };
};

test("a motor enable that times out is re-read, never re-sent, and the wake continues", async () => {
  // Torque-on outlived its own request; the daemon finished it all the same.
  const r = stubbornDaemon({ timesOut: "/api/motors/set_mode/enabled", mode: () => "enabled" });
  await r.client.wakeUp();
  assert.equal(r.count("POST /api/motors/set_mode/enabled"), 1, "an uncertain enable is never repeated");
  assert.equal(r.count("POST /api/move/play/wake_up"), 1, "an actually enabled robot still gets its wake");
  assert.equal(r.client.snapshot().motionEnabled, true);
});

test("a motor enable that times out with motors still disabled fails by request name", async () => {
  const r = stubbornDaemon({ timesOut: "/api/motors/set_mode/enabled" });
  await assert.rejects(r.client.wakeUp(), /POST \/api\/motors\/set_mode\/enabled timed out after 10 s; motors still disabled/);
  assert.equal(r.count("POST /api/motors/set_mode/enabled"), 1);
  assert.equal(r.count("POST /api/move/play/wake_up"), 0, "a failed enable never reaches the movement");
});

test("a wake movement that times out while the daemon moves is awaited, not replayed", async () => {
  let moves = [{ uuid: "wake-fixture" }];
  const r = stubbornDaemon({ timesOut: "/api/move/play/wake_up", mode: () => "enabled", running: () => moves });
  const done = setTimeout(() => { moves = []; }, 250); done.unref?.();
  await r.client.wakeUp();
  assert.equal(r.count("POST /api/move/play/wake_up"), 1, "a physical move is never sent twice");
  assert.ok(r.count("GET /api/move/running") >= 2, "the daemon's running list decides when the move ended");
});

test("a wake movement that times out without starting fails without a second attempt", async () => {
  const r = stubbornDaemon({ timesOut: "/api/move/play/wake_up", mode: () => "enabled" });
  await assert.rejects(r.client.wakeUp(), /POST \/api\/move\/play\/wake_up timed out after 10 s/);
  assert.equal(r.count("POST /api/move/play/wake_up"), 1);
});

// The daemon plays wake_up.wav itself, right after torque-on. A slow volume
// answer must not let that sound out at the robot's previous volume, and a
// robot that never answers must not hold the wake hostage.
const slowVolumeRobot = volumeDelay => {
  const calls = [];
  let current = -1;
  const client = new ReachyMiniClient({ discover: () => () => {}, fetchImpl: async (url, options) => {
    const path = url.replace("http://robot:8000", "");
    calls.push(`${options.method || "GET"} ${path}`);
    if (path === "/api/volume/current") {
      if (volumeDelay === "hang") return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      await new Promise(resolve => setTimeout(resolve, volumeDelay));
      return { ok: true, json: async () => ({ volume: current }) };
    }
    if (path === "/api/motors/status") return { ok: true, json: async () => ({ mode: "enabled" }) };
    if (path === "/api/move/running") return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ uuid: "wake-fixture" }) };
  } });
  client.status = { connected: true, state: "motors-disabled", motionEnabled: false, url: "http://robot:8000" };
  client.socket = { readyState: 1, terminate() {}, send: payload => { const m = JSON.parse(payload); if (m.type === "set_volume") current = m.volume; } };
  client.pose = { head: [...identity], antennas: [-0.1745, 0.1745], body_yaw: 0 };
  return { client, calls };
};

test("the wake waits, but only briefly, for the volume it is about to play at", async t => {
  const slow = slowVolumeRobot(300);
  t.after(() => slow.client.stop());
  await slow.client.wakeUp();
  assert.ok(slow.calls.indexOf("GET /api/volume/current") < slow.calls.indexOf("POST /api/motors/set_mode/enabled"), "the volume is confirmed before torque-on");

  const stuck = slowVolumeRobot("hang");
  t.after(() => stuck.client.stop());
  const started = Date.now();
  await stuck.client.wakeUp();
  const elapsed = Date.now() - started;
  assert.ok(stuck.calls.includes("POST /api/motors/set_mode/enabled"), "an unanswered volume never withholds the wake");
  assert.ok(elapsed < 1600, `a robot that never answers delayed the wake by ${elapsed}ms`);
});

const EXPRESSION_PATH = `/api/move/play/recorded-move-dataset/${encodeURIComponent("pollen-robotics/reachy-mini-emotions-library")}/curious1`;

test("an expression is a queued lifecycle move: URL-encoded, unverified, and never overlapping a sleep", async t => {
  const calls = [];
  let running = [{ uuid: "expression" }];
  const client = new ReachyMiniClient({ discover: () => () => {}, fetchImpl: async (url, options) => {
    const path = url.replace("http://robot:8000", "");
    calls.push(`${options.method || "GET"} ${path}`);
    if (path === "/api/volume/current") return { ok: true, json: async () => ({ volume: 100 }) };
    if (path === "/api/move/running") return { ok: true, json: async () => running };
    if (path === "/api/motors/status") return { ok: true, json: async () => ({ mode: "disabled" }) };
    return { ok: true, json: async () => ({ uuid: path.includes("goto_sleep") ? "sleep" : "expression" }) };
  } });
  t.after(() => client.stop());
  client.status = { connected: true, state: "connected", motionEnabled: true, url: "http://robot:8000" };
  client.socket = { readyState: 1, terminate() {}, send() {} };

  const expression = client.playRecordedMove("pollen-robotics/reachy-mini-emotions-library", "curious1");
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(client.snapshot().motionState, "expression:curious1", "the renderer and the cue policy see a busy robot");
  assert.equal(client.snapshot().waking, false, "an expression is not a lifecycle transition");
  const sleep = client.goToSleep();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls.some(call => call.includes("goto_sleep")), false, "the sleep waits its turn behind the short move");

  running = [];
  await expression;
  running = [];
  await sleep;
  assert.equal(calls.filter(call => call === `POST ${EXPRESSION_PATH}`).length, 1);
  assert.ok(calls.indexOf(`POST ${EXPRESSION_PATH}`) < calls.indexOf("POST /api/move/play/goto_sleep"), "the sleep runs right after the expression");
  assert.equal(client.snapshot().motionState, null);
});

test("an expression that times out is awaited, never re-sent", async () => {
  let moves = [{ uuid: "expression" }];
  const r = stubbornDaemon({ timesOut: EXPRESSION_PATH, mode: () => "enabled", running: () => moves });
  r.client.publish({ motionEnabled: true, state: "connected" });
  const done = setTimeout(() => { moves = []; }, 250); done.unref?.();
  await r.client.playRecordedMove("pollen-robotics/reachy-mini-emotions-library", "curious1");
  assert.equal(r.count(`POST ${EXPRESSION_PATH}`), 1, "a physical move is never sent twice");
  assert.equal(r.count("GET /api/motors/status"), 0, "an expression changes neither torque nor the rest pose");
});

test("app volume is mapped onto the robot's dB-linear control, not sent as a bare percent", () => {
  // Reachy Mini Audio: 0-60 steps over -60..0 dB, so 40 % would be -36 dB (inaudible).
  assert.deepEqual([1, 0.4, 0.1, 0.01, 0, -1, 2].map(robotVolumePercent), [100, 87, 67, 33, 0, 0, 100]);
  const client = new ReachyMiniClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ volume: 87 }) }) });
  let sent = null;
  client.status = { connected: true, state: "connected", motionEnabled: true, url: "http://robot:8000" };
  client.socket = { readyState: 1, terminate() {}, send: payload => { const m = JSON.parse(payload); if (m.type === "set_volume") sent = m.volume; } };
  return client.setVolume(0.4).then(() => assert.equal(sent, 87, "0.4 of full scale is -8 dB, i.e. 87 % of the 60 dB control"));
});

test("a pose frame never overrides the motor mode verified after our own sleep", async t => {
  const r = await robotServer(t);
  r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  assert.equal(r.client.snapshot().motionEnabled, true);
  await r.client.goToSleep();
  assert.equal(r.client.snapshot().sleeping, true);
  for (const socket of r.wss.clients) socket.send(JSON.stringify({ type: "joint_positions", head_joint_positions: [0, 0, 0, 0, 0, 0, 0], antennas_joint_positions: [3, -3] }));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(r.client.snapshot().motionEnabled, false, "50 Hz feedback carries no motor mode");
  assert.equal(r.client.snapshot().sleeping, true, "the sleep we verified stays a sleep");
  for (const socket of r.wss.clients) socket.send(JSON.stringify({ type: "daemon_status", state: "running", backend_status: { motor_control_mode: "enabled" } }));
  for (const socket of r.wss.clients) socket.send(JSON.stringify({ type: "joint_positions", head_joint_positions: [0, 0, 0, 0, 0, 0, 0], antennas_joint_positions: [0.1, -0.1] }));
  await waitFor(() => r.client.snapshot().motionEnabled === true);
  assert.equal(r.client.snapshot().sleeping, false, "the daemon's own status is authoritative when it does report");
});

test("a folded head under a daemon that still reports enabled re-arms torque before the wake", async t => {
  const r = await robotServer(t, { motors: "enabled", wakeRaisesHead: true });
  r.client.start(r.url); await waitFor(() => r.client.snapshot().connected);
  // Torque quietly lost: the head lies at the sleep height while mode says enabled.
  const folded = [1, 0, 0, -0.022, 0, 1, 0, 0, 0, 0, 1, -0.046, 0, 0, 0, 1];
  for (const socket of r.wss.clients) {
    socket.send(JSON.stringify({ type: "head_pose", head_pose: [folded.slice(0, 4), folded.slice(4, 8), folded.slice(8, 12), folded.slice(12)] }));
    socket.send(JSON.stringify({ type: "joint_positions", head_joint_positions: [0, 0, 0, 0, 0, 0, 0], antennas_joint_positions: [-0.7, 0.13] }));
  }
  await waitFor(() => r.client.snapshot().pose && r.client.snapshot().pose.head[11] < -0.03);
  assert.equal(r.client.snapshot().motionEnabled, true);
  await r.client.wakeUp();
  const order = r.requests.map(q => q.url).filter(u => /set_mode|play\/wake_up/.test(u));
  assert.deepEqual(order, ["/api/motors/set_mode/disabled", "/api/motors/set_mode/enabled", "/api/move/play/wake_up"], "torque is cycled once, then the official wake runs");
  assert.equal(r.client.snapshot().motionEnabled, true);
  assert.ok(Math.abs(r.client.snapshot().pose.head[11]) < 0.015, "the head is back at idle height");
});
