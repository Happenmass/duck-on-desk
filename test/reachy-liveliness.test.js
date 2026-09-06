"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReachyLiveliness, PROFILES, RATE_HZ, BLEND_MS, SEND_DEADBAND, BODY_MS_PER_DEG, BODY_LAG_MS, matrixFromEuler, eulerFromMatrix } = require("../src/robots/reachy/reachy-liveliness");

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const heads = sent => sent.filter(s => s.head);
const ants = sent => sent.filter(s => s.antennas);
const DEG = Math.PI / 180;

function harness({ values = {}, pose = { head: identity, antennas: [-0.1745, 0.1745], body_yaw: 0 } } = {}) {
  const prefs = { petRobot: "reachy-mini", reachyExpressions: true, ...values };
  let now = 1_000_000, seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sent = [], timers = [];
  const client = {
    connected: true, motionEnabled: true, sleeping: false, motionState: null, pose,
    snapshot: () => ({ connected: client.connected, motionEnabled: client.motionEnabled, sleeping: client.sleeping, motionState: client.motionState, pose: client.pose }),
    sendTarget: (head, antennas, body) => { sent.push({ head, antennas, body, at: now }); return client.socketOpen !== false; },
  };
  let sleepIntended = false;
  const liveliness = createReachyLiveliness({
    client, settings: { get: key => prefs[key] },
    isReachySelected: () => prefs.petRobot === "reachy-mini",
    isSleepIntended: () => sleepIntended,
    now: () => now, random,
    setIntervalImpl: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; },
    clearIntervalImpl: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const step = (ms = 1000 / RATE_HZ, n = 1) => { for (let i = 0; i < n; i++) { now += ms; liveliness._tick(); } };
  return { liveliness, client, prefs, sent, timers, step, setSleepIntended: v => { sleepIntended = v; }, get now() { return now; } };
}

test("head matrices follow the daemon's extrinsic x-y-z convention and round-trip", () => {
  const m = matrixFromEuler(0.01, -0.02, 0.03, 0.2, -0.15, 0.4);
  // Orthonormal rotation block.
  const r = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const dot = r[0][i] * r[0][j] + r[1][i] * r[1][j] + r[2][i] * r[2][j];
    assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-12);
  }
  const e = eulerFromMatrix(m);
  assert.deepEqual([e.x, e.y, e.z].map(v => +v.toFixed(9)), [0.01, -0.02, 0.03]);
  assert.deepEqual([e.roll, e.pitch, e.yaw].map(v => +v.toFixed(9)), [0.2, -0.15, 0.4]);
  // Pure yaw rotates x into y, the SciPy from_euler("xyz") reading.
  const yaw90 = matrixFromEuler(0, 0, 0, 0, 0, Math.PI / 2);
  assert.deepEqual([yaw90[0], yaw90[4]].map(v => +v.toFixed(9)), [0, 1]);
  assert.deepEqual(eulerFromMatrix(identity), { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 });
});

test("streams only for an awake, connected robot in a mapped state, and stops for every gate", () => {
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  assert.equal(h.timers.length, 1, "one 50 Hz ticker per connection");
  assert.ok(Math.abs(h.timers[0].ms - 1000 / RATE_HZ) < 1e-9);
  h.liveliness.handleState("idle");
  h.step(20, 5);
  assert.ok(h.sent.length >= 1 && h.sent.length <= 5, "streams while eligible");
  const cases = [
    ["disconnected", () => { h.client.connected = false; }, () => { h.client.connected = true; }],
    ["motors off", () => { h.client.motionEnabled = false; }, () => { h.client.motionEnabled = true; }],
    ["asleep", () => { h.client.sleeping = true; }, () => { h.client.sleeping = false; }],
    ["lifecycle move", () => { h.client.motionState = "wake_up"; }, () => { h.client.motionState = null; }],
    ["expression", () => { h.client.motionState = "expression:curious1"; }, () => { h.client.motionState = null; }],
    ["no pose yet", () => { h.client.pose = null; }, () => { h.client.pose = { head: identity, antennas: [0, 0] }; }],
    ["sleep intended", () => h.setSleepIntended(true), () => h.setSleepIntended(false)],
    ["pref off", () => { h.prefs.reachyExpressions = false; }, () => { h.prefs.reachyExpressions = true; }],
    ["duck selected", () => { h.prefs.petRobot = "duck"; }, () => { h.prefs.petRobot = "reachy-mini"; }],
    ["unmapped state", () => h.liveliness.handleState("notification"), () => h.liveliness.handleState("idle")],
    ["sleeping state", () => h.liveliness.handleState("sleeping"), () => h.liveliness.handleState("idle")],
  ];
  for (const [name, close, open] of cases) {
    const before = h.sent.length;
    close(); h.step(20, 3);
    assert.equal(h.sent.length, before, `${name}: nothing streamed`);
    open(); h.step(20, 1);
    assert.equal(h.sent.length, before + 1, `${name}: resumes`);
  }
  h.liveliness.onStatus({ connected: false });
  assert.equal(h.timers.length, 0, "ticker released on disconnect");
  h.liveliness.onStatus({ connected: true });
  h.liveliness.dispose();
  assert.equal(h.timers.length, 0, "dispose releases the ticker");
});

test("motion starts from the measured pose and blends in over one second", () => {
  const start = { head: matrixFromEuler(0.004, -0.003, 0.014, 0.05, 0.12, -0.3), antennas: [0.9, -0.4] };
  const h = harness({ pose: start });
  h.liveliness.onStatus({ connected: true });
  h.liveliness.handleState("idle");
  h.step(1000 / RATE_HZ);
  const first = h.sent[0];
  assert.deepEqual(first.head.map(v => +v.toFixed(9)), start.head.map(v => +v.toFixed(9)), "first target is where the head already is");
  assert.deepEqual(first.antennas, start.antennas);
  h.step(1000 / RATE_HZ, Math.ceil(BLEND_MS / (1000 / RATE_HZ)) + 5);
  const e = eulerFromMatrix(heads(h.sent).pop().head);
  assert.ok(e.yaw >= PROFILES.idle.yaw[0] * DEG - 1e-9 && e.yaw <= PROFILES.idle.yaw[1] * DEG + 1e-9, "after the blend the head is inside the idle range");
  // Consecutive targets never jump: once blended in, the biggest per-tick change stays tiny.
  let maxStep = 0;
  const hs = heads(h.sent), as = ants(h.sent);
  for (let i = Math.ceil(BLEND_MS / (1000 / RATE_HZ)) + 2; i < hs.length; i++) {
    const a = eulerFromMatrix(hs[i - 1].head), b = eulerFromMatrix(hs[i].head);
    maxStep = Math.max(maxStep, Math.abs(a.z - b.z) * 1000, Math.abs(a.yaw - b.yaw) / DEG);
  }
  for (let i = Math.ceil(BLEND_MS / (1000 / RATE_HZ)) + 2; i < as.length; i++) maxStep = Math.max(maxStep, Math.abs(as[i].antennas[0] - as[i - 1].antennas[0]) / DEG);
  assert.ok(maxStep < 1.2, `per-send change ${maxStep.toFixed(3)} (mm or deg) stays below 1.2`);
});

test("amplitudes stay inside the profile envelope, glances hold, and moods differ", () => {
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  const TICK = 1000 / RATE_HZ;
  for (const state of ["idle", "working", "thinking"]) {
    h.liveliness.handleState(state);
    h.sent.length = 0;
    h.step(TICK, 60 * RATE_HZ);
    const p = PROFILES[state];
    const eps = 1e-6;
    // Skip the blend and the transition glance out of the previous mood (up to
    // ~1.4 s, stretched further when the body turns): judge the envelope after 4 s.
    const t0 = h.sent[0].at;
    const settled = h.sent.filter(s => s.at - t0 > 4000);
    const hs = heads(settled);
    for (const { head } of hs) {
      const e = eulerFromMatrix(head);
      assert.ok(Math.abs(e.z) <= p.z + eps && Math.abs(e.x) < eps && Math.abs(e.y) < eps, `${state}: z within ±${p.z * 1000} mm`);
      assert.ok(e.yaw >= p.yaw[0] * DEG - eps && e.yaw <= p.yaw[1] * DEG + eps, `${state}: yaw within its range`);
      assert.ok(e.pitch >= p.pitch[0] * DEG - eps && e.pitch <= p.pitch[1] * DEG + eps, `${state}: pitch within its range`);
      assert.ok(e.roll >= p.roll[0] * DEG - eps && e.roll <= p.roll[1] * DEG + eps, `${state}: roll within its range`);
    }
    for (const { antennas } of ants(settled)) {
      assert.ok(Math.abs(antennas[0]) <= p.ant * DEG + eps && Math.abs(antennas[0] + antennas[1]) < eps, `${state}: antennas sway in opposition within ±${p.ant}°`);
    }
    // Holds are silent for the head: far fewer head sends than ticks, and the
    // orientation is unchanged across most consecutive head sends (breathing only).
    let holds = 0, moves = 0, prev = null;
    for (const { head } of hs) { const e = eulerFromMatrix(head); if (prev) { const d = Math.abs(e.yaw - prev.yaw) + Math.abs(e.pitch - prev.pitch) + Math.abs(e.roll - prev.roll); if (d < 1e-12) holds++; else moves++; } prev = e; }
    // Body turns stretch the moves, so working streams for up to half the time; holds stay silent either way.
    assert.ok(hs.length < 60 * RATE_HZ / 2, `${state}: ${hs.length} head sends over ${60 * RATE_HZ} ticks`);
    assert.ok(holds > 0 && moves > 0, `${state}: both breathing-only sends (${holds}) and glance sends (${moves}) occur`);
    const zs = hs.map(s => eulerFromMatrix(s.head).z);
    assert.ok(Math.max(...zs) > p.z * 0.95 && Math.min(...zs) < -p.z * 0.95, `${state}: breathing uses its full amplitude`);
  }
  assert.ok(PROFILES.working.pitch[1] < 0 && PROFILES.thinking.pitch[0] > 0, "working looks down at the work, thinking looks up");
  assert.ok(PROFILES.working.move[1] < PROFILES.idle.move[0] && PROFILES.working.hold[1] < PROFILES.idle.hold[0], "working glances are quicker and more frequent than idle");
  assert.equal(PROFILES.roam, PROFILES.idle);
});

test("a mood change starts a new glance from the current orientation, never from the old target", () => {
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  h.liveliness.handleState("idle");
  const TICK = 1000 / RATE_HZ;
  h.step(TICK, Math.ceil(BLEND_MS / TICK) + 20); // blended in, mid-glance
  const before = eulerFromMatrix(heads(h.sent).pop().head);
  h.liveliness.handleState("working");
  h.step(TICK, 3);
  const after = eulerFromMatrix(heads(h.sent).pop().head);
  assert.ok(Math.abs(after.yaw - before.yaw) < 2.5 * DEG && Math.abs(after.pitch - before.pitch) < 2.5 * DEG, "no jump on retarget");
});

test("a rejected send drops the blend so the next accepted target restarts from the measured pose", () => {
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  h.liveliness.handleState("working");
  h.step(1000 / RATE_HZ, 30);
  h.client.socketOpen = false; h.step(1000 / RATE_HZ);
  h.client.socketOpen = true;
  h.client.pose = { head: matrixFromEuler(0, 0, -0.02, 0, 0, 0.2), antennas: [0.5, 0.5] };
  h.step(1000 / RATE_HZ);
  const e = eulerFromMatrix(heads(h.sent).pop().head);
  assert.deepEqual([+e.z.toFixed(6), +e.yaw.toFixed(6)], [-0.02, 0.2]);
});

test("nothing is re-sent until the target has moved past the daemon's IK tolerance", () => {
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  h.liveliness.handleState("idle");
  const TICK = 1000 / RATE_HZ;
  h.step(TICK, 30 * RATE_HZ);
  const hs = heads(h.sent), as = ants(h.sent), ticks = 30 * RATE_HZ;
  assert.ok(hs.length < ticks / 3, `${hs.length} head sends over ${ticks} ticks: holds and slow breathing leave the head IK alone`);
  for (let i = 1; i < hs.length; i++) {
    const a = eulerFromMatrix(hs[i - 1].head), b = eulerFromMatrix(hs[i].head);
    const moved = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= SEND_DEADBAND.m - 1e-12
      || Math.abs(a.yaw - b.yaw) >= SEND_DEADBAND.rad - 1e-12 || Math.abs(a.pitch - b.pitch) >= SEND_DEADBAND.rad - 1e-12 || Math.abs(a.roll - b.roll) >= SEND_DEADBAND.rad - 1e-12
      || Math.abs(hs[i].body - hs[i - 1].body) >= SEND_DEADBAND.rad - 1e-12;
    assert.ok(moved, `head send ${i} differs from the previous one (head or body) by at least the deadband`);
  }
  for (let i = 1; i < as.length; i++) assert.ok(Math.abs(as[i].antennas[0] - as[i - 1].antennas[0]) >= SEND_DEADBAND.antRad - 1e-12, `antenna send ${i} moved past the deadband`);
  assert.ok(h.sent.some(s => s.antennas && !s.head), "antenna-only messages exist, so the sway never re-solves the head IK");
});

test("large turns go through the body: the neck never twists past the profile's neck limit", () => {
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  const TICK = 1000 / RATE_HZ;
  for (const state of ["working", "idle", "thinking"]) {
    h.liveliness.handleState(state);
    h.sent.length = 0;
    h.step(TICK, 90 * RATE_HZ);
    const p = PROFILES[state];
    const hs = heads(h.sent).slice(Math.ceil(BLEND_MS / TICK));
    let bodyMoved = false;
    for (const { head, body } of hs) {
      assert.ok(Number.isFinite(body), `${state}: every head message carries body_yaw`);
      const e = eulerFromMatrix(head);
      assert.ok(Math.abs(e.yaw - body) <= p.neck * DEG + 1e-6, `${state}: neck twist ${((e.yaw - body) / DEG).toFixed(2)}° within ±${p.neck}°`);
      assert.ok(body >= p.yaw[0] * DEG - 1e-6 && body <= p.yaw[1] * DEG + 1e-6, `${state}: body yaw within the yaw range`);
      if (Math.abs(body) > 1e-6) bodyMoved = true;
    }
    assert.ok(bodyMoved, `${state}: the body actually turns for the wide glances`);
  }
});

test("a glance that turns the body takes longer than one that only moves the neck", () => {
  assert.ok(BODY_MS_PER_DEG > 0);
  // Two 400 ms glances differing only by 10° of body travel: the second is stretched by 100 %.
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  h.liveliness.handleState("working");
  h.step(1000 / RATE_HZ, 60 * RATE_HZ);
  const hs = heads(h.sent);
  // Reconstruct move phases from consecutive orientation changes; every move
  // with body travel spans more ticks per degree than the fastest neck-only move.
  let moves = [], cur = null;
  for (let i = 1; i < hs.length; i++) {
    const a = eulerFromMatrix(hs[i - 1].head), b = eulerFromMatrix(hs[i].head);
    const turning = Math.abs(b.yaw - a.yaw) + Math.abs(b.pitch - a.pitch) + Math.abs(b.roll - a.roll) > 1e-9;
    if (turning) { if (!cur) cur = { ticks: 0, body: 0 }; cur.ticks++; cur.body += Math.abs(hs[i].body - hs[i - 1].body) / DEG; }
    else if (cur) { moves.push(cur); cur = null; }
  }
  const neckOnly = moves.filter(m => m.body < 0.5), withBody = moves.filter(m => m.body > 4);
  assert.ok(neckOnly.length && withBody.length, `both kinds of glance occur (${neckOnly.length} neck-only, ${withBody.length} with body)`);
  const avg = a => a.reduce((x, m) => x + m.ticks, 0) / a.length;
  assert.ok(avg(withBody) > avg(neckOnly), `body turns are slower: ${avg(withBody).toFixed(0)} vs ${avg(neckOnly).toFixed(0)} sends per move`);
});

test("the head leads and the body follows after a short lag, never past the neck limit", () => {
  assert.ok(BODY_LAG_MS > 0);
  // Observe the commanded stream at tick resolution: no deadband for this test.
  const saved = { ...SEND_DEADBAND };
  Object.assign(SEND_DEADBAND, { m: 0, rad: 0, antRad: 0 });
  const h = harness();
  h.liveliness.onStatus({ connected: true });
  h.liveliness.handleState("working");
  const TICK = 1000 / RATE_HZ;
  try { h.step(TICK, 90 * RATE_HZ); } finally { Object.assign(SEND_DEADBAND, saved); }
  const hs = heads(h.sent);
  // For every glance that turns the body: the first head-yaw change after a
  // hold comes before the first body change, by the lag (minus one tick).
  let checked = 0;
  for (let i = 2; i < hs.length; i++) {
    const a = eulerFromMatrix(hs[i - 2].head), b = eulerFromMatrix(hs[i - 1].head), c = eulerFromMatrix(hs[i].head);
    if (!(Math.abs(b.yaw - a.yaw) < 1e-9 && Math.abs(c.yaw - b.yaw) > 1e-6)) continue;
    const bodyAtStart = hs[i - 1].body, tHead = hs[i].at;
    if (!hs.slice(i).some(s => Math.abs(s.body - bodyAtStart) > 2 * DEG)) continue; // neck-only glance
    const follow = hs.slice(i).find(s => Math.abs(s.body - bodyAtStart) > 1e-6);
    const direction = Math.sign(follow.body - bodyAtStart), relAtStart = (b.yaw - bodyAtStart) * direction;
    if (relAtStart >= (PROFILES.working.neck - 1) * DEG) continue; // neck already at its limit that way: the body must lead
    checked++;
    assert.ok(follow.at - tHead >= BODY_LAG_MS - 2 * TICK, `glance at ${tHead}: body follows ${(follow.at - tHead).toFixed(0)} ms after the head (lag ${BODY_LAG_MS} ms)`);
  }
  assert.ok(checked >= 3, `enough body-turning glances were checked (${checked})`);
  for (const { head, body } of hs) assert.ok(Math.abs(eulerFromMatrix(head).yaw - body) <= PROFILES.working.neck * DEG + 1e-6, "neck twist stays within the limit while the body catches up");
});
