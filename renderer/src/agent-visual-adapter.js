// Translates the theme's intent ids (themes/duck/theme.json states) into DuckRuntime commands.
// planForVisual is pure; createBehaviours owns timers so a new visual always cancels the previous one.
export const INTENT_IDS = new Set([
  "duck-idle", "duck-thinking", "duck-working", "duck-juggling", "duck-carrying", "duck-sweeping",
  "duck-attention", "duck-notification", "duck-error", "duck-sleeping", "duck-waking", "duck-roam",
]);

const SYSTEM = "system";

export function planForVisual(file) {
  switch (file) {
    case "duck-roam": return { kind: "roam", forward: ROAM_FORWARD, periodMs: 2000 };
    case "duck-thinking": return { kind: "look", everyMs: 1500 };
    case "duck-working": return { kind: "walk", forward: 0.7, heading: 0, periodMs: 2000 };
    case "duck-juggling": return { kind: "sweep", forward: 0.8, amplitude: 0.8, periodMs: 3000 };
    case "duck-carrying": return { kind: "peck", everyMs: 0 };
    case "duck-sweeping": return { kind: "peck", everyMs: 4000 };
    case "duck-attention": return { kind: "face", quackEveryMs: 0 };
    case "duck-notification": return { kind: "face", quackEveryMs: 2500 };
    case "duck-error": return { kind: "sulk" };
    case "duck-sleeping": return { kind: "sleep" };
    case "duck-waking": return { kind: "wake" };
    default: return { kind: "idle" };
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

// Roam walks in side profile (camera at ±90° of the beak) so the window slides
// sideways by the duck's own stride; a per-walk tilt of up to ±ROAM_TILT rad
// toward/away from the camera turns into the walk's slight downward/upward drift.
export const ROAM_FORWARD = 0.45;
export const ROAM_TILT = 0.2;

export function createBehaviours({ runtime, autonomy, clock = globalThis, random = Math.random }) {
  let timer = null;
  let current = "duck-idle";
  let roamLeft = null; // last roam-heading from main; null until the first roam
  let roamTilt = 0;
  const roamHeading = () => (roamLeft ? 1 : -1) * (Math.PI / 2 + roamTilt);
  const cmd = (intent) => runtime.command({ source: SYSTEM, ...intent });
  const every = (ms, fn) => { fn(); timer = clock.setInterval(fn, ms); };
  const stopTimer = () => { if (timer !== null) { clock.clearInterval(timer); timer = null; } };

  function apply(file) {
    stopTimer();
    current = file;
    const plan = planForVisual(file);
    if (plan.kind === "idle") {
      // Leaving an agent-driven state: get back on our feet before handing
      // control to the autonomy adapter, which only acts while walking.
      const snapshot = typeof runtime.snapshot === "function" ? runtime.snapshot() : {};
      if (snapshot && snapshot.sleeping) cmd({ type: "wake" });
      else if (snapshot && (snapshot.mode === "sit" || snapshot.mode === "sitting")) cmd({ type: "perform", action: "stand" });
      cmd({ type: "stop" });
      autonomy.resume();
      return plan;
    }
    autonomy.pause();
    switch (plan.kind) {
      case "look":
        // Busy = walking in place: keep re-leasing the walk for as long as the
        // state lasts (a session mostly sits in "thinking" between tool calls).
        every(plan.everyMs, () => {
          cmd({ type: "move", forward: 0.6, heading: 0, ttlMs: plan.everyMs * 2 });
          cmd({ type: "look", headYaw: rand(-0.6, 0.6), headPitch: rand(-0.25, 0.25), neckPitch: rand(-0.2, 0.2), headRoll: 0 });
        });
        break;
      case "walk":
        every(plan.periodMs, () => cmd({ type: "move", forward: plan.forward, heading: plan.heading, ttlMs: plan.periodMs + 600 }));
        break;
      case "sweep": {
        let side = 1;
        every(plan.periodMs, () => { side = -side; cmd({ type: "move", forward: plan.forward, heading: side * plan.amplitude, ttlMs: plan.periodMs + 600 }); });
        break;
      }
      case "peck":
        if (plan.everyMs > 0) every(plan.everyMs, () => cmd({ type: "perform", action: "peck" }));
        else cmd({ type: "perform", action: "peck" });
        break;
      case "face":
        cmd({ type: "move", forward: 0.6, heading: 0, ttlMs: 1500 });
        if (plan.quackEveryMs > 0) every(plan.quackEveryMs, () => cmd({ type: "perform", action: "quack" }));
        else cmd({ type: "perform", action: "quack" });
        break;
      case "roam": {
        // Main moves the window; the duck walks toward that side. Until main's
        // roam-heading arrives, follow the side the duck already leans to.
        if (roamLeft === null) {
          const snapshot = typeof runtime.snapshot === "function" ? runtime.snapshot() : {};
          roamLeft = !!(snapshot && snapshot.facing > 0);
        }
        roamTilt = (random() * 2 - 1) * ROAM_TILT;
        every(plan.periodMs, () => cmd({ type: "move", forward: plan.forward, heading: roamHeading(), ttlMs: plan.periodMs + 600 }));
        break;
      }
      case "sulk":
        cmd({ type: "perform", action: "sit" });
        cmd({ type: "look", headPitch: 0.5, headYaw: 0, neckPitch: 0, headRoll: 0 });
        break;
      case "sleep":
        cmd({ type: "sleep" });
        break;
      case "wake":
        cmd({ type: "wake" });
        break;
      default:
        break;
    }
    return plan;
  }

  // Cursor-relative glance while idle: dx/dy are quantized pixel offsets from the pet centre.
  function eye(dx, dy) {
    if (current !== "duck-idle") return;
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    cmd({ type: "look", headYaw: clamp(-dx / 200, 0.6), headPitch: clamp(dy / 200, 0.3), neckPitch: 0, headRoll: 0 });
  }

  function setRoamHeading(left) {
    roamLeft = !!left;
    if (current === "duck-roam") cmd({ type: "move", forward: ROAM_FORWARD, heading: roamHeading(), ttlMs: 2600 });
  }

  return { apply, eye, setRoamHeading, current: () => current, dispose: stopTimer };
}
