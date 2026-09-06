"use strict";

// Continuous "alive" motion for a connected, awake Reachy Mini. Two layers, both
// streamed as `set_full_target` over the SDK socket at 60 Hz (the official
// conversation app's rate; the daemon's loop is 50 Hz, so every loop sees a
// fresh target and drops ours while one of its own moves runs):
//   - breathing: a z sinusoid plus an antenna sway, as in the official
//     BreathingMove (5 mm at 0.1 Hz, ±15° at 0.5 Hz);
//   - glances: the head moves to a new orientation with a smoothstep and then
//     holds. One decisive move at a time keeps the six head servos from
//     reversing against each other (the rattle small superimposed sinusoids
//     produce) and reads as a mood: idle looks around lazily, thinking tilts
//     and looks up, working looks down at the work and scans it.
// A 1 s blend from the measured pose makes every (re)start seamless. Rotation
// convention is the daemon's create_head_pose: extrinsic x-y-z, i.e.
// R = Rz(yaw) · Ry(pitch) · Rx(roll), row-major 4x4, metres/radians.
const RATE_HZ = 60;
const BLEND_MS = 1000;
// Every received target makes the daemon re-solve IK and re-write six servo
// goals; on the real robot that alone twitches the head by up to ~0.7° even
// when the target never changes (measured 2026-09-06). So a target is sent only
// once it has moved further than the daemon's own IK tolerance, which also
// means nothing at all is sent while the head holds a glance.
const SEND_DEADBAND = { m: 0.0004, rad: 0.15 * (Math.PI / 180), antRad: 0.5 * (Math.PI / 180) };
// z metres; angles degrees; times ms. pitch: negative looks down. `yaw` is the
// total turn in the world frame; the neck only twists up to `neck` degrees
// relative to the body (a head pitched down and yawed 14° on the neck alone
// hits the body shell): glances within `neck` of the current body heading are
// neck-only, wider ones are carried by the body. Moves that turn the body are
// stretched by 10 % per degree of body travel so it stays gentle.
const PROFILES = {
  idle:     { z: 0.005, zHz: 0.10, ant: 15, antHz: 0.50, yaw: [-15, 15], neck: 6, pitch: [-5, 5],   roll: [-3, 3],   move: [900, 1400], hold: [2500, 6000] },
  thinking: { z: 0.004, zHz: 0.14, ant: 12, antHz: 0.60, yaw: [-8, 8],   neck: 4, pitch: [2, 9],    roll: [-12, 12], move: [900, 1300], hold: [1800, 4000] },
  working:  { z: 0.005, zHz: 0.25, ant: 12, antHz: 0.80, yaw: [-20, 20], neck: 5, pitch: [-14, -2], roll: [-6, 6],   move: [350, 550],  hold: [700, 2200] },
};
const BODY_MS_PER_DEG = 0.1;
// The head leads and the body follows: the body's share of a glance starts this
// much later. The neck still never twists past `neck`, so while the body is
// catching up the head simply waits at the limit — head-first, then the turn.
const BODY_LAG_MS = 150;
PROFILES.roam = PROFILES.idle;
PROFILES.juggling = PROFILES.working;

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = u => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

function matrixFromEuler(x, y, z, roll, pitch, yaw) {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y,
    -sp,     cp * sr,                cp * cr,                z,
    0, 0, 0, 1,
  ];
}
function eulerFromMatrix(m) {
  const e = { x: m[3], y: m[7], z: m[11], roll: Math.atan2(m[9], m[10]), pitch: Math.asin(clamp(-m[8], -1, 1)), yaw: Math.atan2(m[4], m[0]) };
  for (const k in e) e[k] = e[k] || 0; // no negative zero out of asin/atan2
  return e;
}

function createReachyLiveliness({ client, settings, isReachySelected, isSleepIntended, now = Date.now, random = Math.random, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let timer = null, state = null, startedAt = null, base = null, glance = null, disposed = false, lastSent = null;

  const enabled = () => !disposed && settings.get("reachyExpressions") !== false && isReachySelected();
  const profile = () => PROFILES[state] || null;
  const gate = () => {
    if (!enabled() || !profile() || isSleepIntended()) return null;
    const s = client.snapshot();
    // A lifecycle move or an expression owns the head; the daemon would drop
    // our targets anyway, and we must re-blend from wherever it leaves the head.
    if (!s.connected || !s.motionEnabled || s.sleeping || s.motionState || !s.pose) return null;
    return s.pose;
  };
  const pick = ([lo, hi]) => lo + random() * (hi - lo);

  // Orientation layer: from -> to over `move` ms, then hold until `until`.
  let retarget = false;
  const nextGlance = (p, from, at) => {
    // A small glance is neck-only; a wide one is carried entirely by the body,
    // which parks the neck straight so the next glance can lead with the head
    // again in either direction.
    const yaw = pick(p.yaw) * DEG, body = Math.abs(yaw - from.body) <= p.neck * DEG ? from.body : yaw;
    const to = { yaw, body, pitch: pick(p.pitch) * DEG, roll: pick(p.roll) * DEG };
    return { from, to, start: at, move: pick(p.move) * (1 + BODY_MS_PER_DEG * Math.abs(to.body - from.body) / DEG), until: 0 };
  };
  const lerp = (g, u, uBody, neck) => {
    const body = g.from.body + (g.to.body - g.from.body) * uBody;
    const want = g.from.yaw + (g.to.yaw - g.from.yaw) * u;
    return { yaw: body + clamp(want - body, -neck, neck), body, pitch: g.from.pitch + (g.to.pitch - g.from.pitch) * u, roll: g.from.roll + (g.to.roll - g.from.roll) * u };
  };
  const orientation = (p, at) => {
    if (!glance) glance = nextGlance(p, { yaw: 0, body: 0, pitch: 0, roll: 0 }, at);
    const neck = p.neck * DEG;
    let u = smoothstep((at - glance.start) / glance.move), uBody = smoothstep((at - glance.start - BODY_LAG_MS) / glance.move);
    if (retarget || (glance.until && at >= glance.until)) {
      // A new glance always departs from where the head and body are right now.
      glance = nextGlance(p, lerp(glance, u, uBody, neck), at);
      retarget = false;
      u = 0; uBody = 0;
    }
    if (uBody >= 1 && !glance.until) glance.until = at + pick(p.hold);
    return lerp(glance, u, uBody, neck);
  };

  const target = (p, at) => {
    const t = (at - startedAt) / 1000, b = clamp((at - startedAt) / BLEND_MS, 0, 1);
    const o = orientation(p, at);
    const sway = p.ant * DEG * Math.sin(2 * Math.PI * p.antHz * t);
    const gen = { x: 0, y: 0, z: p.z * Math.sin(2 * Math.PI * p.zHz * t), ...o, antennas: [sway, -sway] };
    const mix = (from, to) => from + (to - from) * b;
    const e = { x: mix(base.x, gen.x), y: mix(base.y, gen.y), z: mix(base.z, gen.z), roll: mix(base.roll, gen.roll), pitch: mix(base.pitch, gen.pitch), yaw: mix(base.yaw, gen.yaw), body: mix(base.body, gen.body) };
    // The head matrix is a world-frame pose (total yaw); body_yaw tells the IK
    // how much of it the body provides, so the neck keeps yaw - body.
    return { e, head: matrixFromEuler(e.x, e.y, e.z, e.roll, e.pitch, e.yaw), antennas: [mix(base.antennas[0], gen.antennas[0]), mix(base.antennas[1], gen.antennas[1])] };
  };
  // Head and antennas are judged separately: a message without `head` does not
  // touch the head IK at all, so the antenna sway never churns the head servos.
  const headChanged = e => !lastSent.e
    || Math.hypot(e.x - lastSent.e.x, e.y - lastSent.e.y, e.z - lastSent.e.z) >= SEND_DEADBAND.m
    || Math.abs(e.roll - lastSent.e.roll) >= SEND_DEADBAND.rad || Math.abs(e.pitch - lastSent.e.pitch) >= SEND_DEADBAND.rad || Math.abs(e.yaw - lastSent.e.yaw) >= SEND_DEADBAND.rad
    || Math.abs(e.body - lastSent.e.body) >= SEND_DEADBAND.rad;
  const antennasChanged = a => !lastSent.antennas
    || Math.abs(a[0] - lastSent.antennas[0]) >= SEND_DEADBAND.antRad || Math.abs(a[1] - lastSent.antennas[1]) >= SEND_DEADBAND.antRad;

  const tick = () => {
    const pose = gate();
    if (!pose) { startedAt = null; return; }
    const at = now();
    if (startedAt === null) {
      // Start from the measured pose, whatever the last move left behind, and
      // let the first glance depart from there instead of from neutral.
      base = { ...eulerFromMatrix(pose.head), body: Number.isFinite(pose.body_yaw) ? pose.body_yaw : 0, antennas: [...pose.antennas] };
      startedAt = at;
      glance = null; retarget = false; lastSent = { e: null, antennas: null };
    }
    const { e, head, antennas } = target(profile(), at);
    const sendHead = headChanged(e), sendAntennas = antennasChanged(antennas);
    if (!sendHead && !sendAntennas) return;
    if (client.sendTarget(sendHead ? head : null, sendAntennas ? antennas : null, sendHead ? e.body : null)) {
      if (sendHead) lastSent.e = e;
      if (sendAntennas) lastSent.antennas = antennas;
    } else startedAt = null;
  };

  const run = on => {
    if (on && !timer) { timer = setIntervalImpl(tick, 1000 / RATE_HZ); timer.unref?.(); }
    if (!on && timer) { clearIntervalImpl(timer); timer = null; startedAt = null; }
  };

  return {
    // A new mood starts a fresh glance from the current orientation; breathing
    // and the blend continue uninterrupted.
    handleState(next) { if (next !== state) { state = next; retarget = true; } },
    // The 60 Hz ticker only exists while a robot is connected.
    onStatus(status) { run(!disposed && status.connected === true && enabled()); },
    refresh() { run(!disposed && client.snapshot().connected === true && enabled()); },
    dispose() { disposed = true; run(false); },
    _tick: tick,
  };
}

module.exports = { createReachyLiveliness, PROFILES, RATE_HZ, BLEND_MS, SEND_DEADBAND, BODY_MS_PER_DEG, BODY_LAG_MS, matrixFromEuler, eulerFromMatrix };
