// Idle-gesture constants and pure curves shared by the runtime and the
// autonomy adapter. Values mirror the official simulator (game.js).

// Head command slots cmd[3..6] of every alpha policy, robot-runtime order.
export const HEAD_KEYS = ["neckPitch", "headPitch", "headYaw", "headRoll"];
export const HEAD_MAX = 2.5; // rad, runtime head_max
export const HEAD_ALPHA = 0.2; // EMA per 50 Hz control step

// alpha_ground_pick.onnx: phase clock advancing at 1/periodS per second,
// cycle exits at endPhase (~2.8 s). The ONNX export has no mouth channel,
// so the beak is re-created on the same clock: open on approach, snap shut
// on the scoop.
export const GROUND_PICK = { periodS: 4.0, endPhase: 0.7 };
const PICK_JAW_KEYS = [[0.10, 0], [0.20, 1], [0.40, 1], [0.50, 0]];

export const QUACK_MS = 480;

export function pickJawOpenness(phase) {
  if (typeof phase !== "number") return 0;
  const keys = PICK_JAW_KEYS;
  if (phase <= keys[0][0] || phase >= keys[keys.length - 1][0]) return 0;
  for (let i = 1; i < keys.length; i++) {
    if (phase > keys[i][0]) continue;
    const [p0, v0] = keys[i - 1];
    const [p1, v1] = keys[i];
    const t = (phase - p0) / (p1 - p0);
    return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * t)) / 2;
  }
  return 0;
}

export function quackJawOpenness(elapsedMs) {
  const t = elapsedMs / QUACK_MS;
  return t >= 0 && t < 1 ? Math.sin(Math.PI * t) : 0;
}

// Footstep heuristic (official game.js): each ankle's height relative to the
// lower ankle, lift/contact hysteresis and a per-foot debounce. Mutates
// `foot` and returns the tap gain when the foot just landed, else null.
export const STEP = { lift: 0.012, contact: 0.005, debounceMs: 130 };
export function footLanding(foot, z, ground, dt, now) {
  const rel = z - ground;
  const vz = (z - foot.prevZ) / dt;
  foot.prevZ = z;
  if (rel > STEP.lift) {
    foot.air = true;
    return null;
  }
  if (foot.air && rel < STEP.contact && vz < -0.02 && now - foot.lastAt > STEP.debounceMs) {
    foot.air = false;
    foot.lastAt = now;
    return 0.12 + 0.14 * Math.min(1, Math.abs(vz) / 0.35);
  }
  return null;
}

// Landing thump: the trunk was dropping fast and stopped within one control
// step. Returns impact strength 0..1 or null. The walking gait never reaches
// -0.4 m/s vertically, so it stays silent while stepping.
export function landingImpact(prevVz, vz) {
  if (prevVz < -0.4 && vz - prevVz > 0.35) return Math.min(1, (-prevVz - 0.4) / 1.5);
  return null;
}

// Heading control. `facing` is the camera bearing relative to the duck's
// forward axis (rad, 0 = looking at the viewer; a positive turn command
// decreases it). Autonomous wandering keeps facing inside ±FACING_HALF_CONE
// so the duck never shows its back.
//
// Measured on the walking policy (2026-09-04): yaw commands below ~0.5 are
// ignored at low speed, a full command turns at only 0.4–0.65 rad/s, and
// turning in place without stepping stalls in one direction. So the
// controller is bang-bang with hysteresis along the shortest arc, and the
// runtime forces a stepping speed while it is engaged.
export const FACING_HALF_CONE = Math.PI / 3; // 120° cone facing the camera
export const HEADING_ENGAGE = 0.25; // rad of error that starts a turn
export const HEADING_RELEASE = 0.12; // rad of error that ends it
export const HEADING_MIN_FORWARD = 0.6; // stepping speed the walker needs to turn reliably
export const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
export function headingTurn(facing, target, engaged) {
  const error = wrapAngle(facing - target);
  const on = Math.abs(error) > (engaged ? HEADING_RELEASE : HEADING_ENGAGE);
  return { turn: on ? Math.sign(error) : 0, engaged: on };
}

// Camera-rig ease-down after a landing. This used to be a bare `lift * 0.75`
// applied once per rendered frame, which quietly tied the settle time to the
// display's refresh rate — and broke outright when the render loop was capped
// to 30 fps. Decaying on elapsed time instead keeps one feel at any frame rate;
// CAMERA_LIFT_TAU_MS is chosen so 120 Hz still behaves as it always did.
export const CAMERA_LIFT_TAU_MS = 29;
export const cameraLiftDecay = (lift, elapsedMs, tauMs = CAMERA_LIFT_TAU_MS) =>
  (elapsedMs > 0 ? lift * Math.exp(-elapsedMs / tauMs) : lift);
