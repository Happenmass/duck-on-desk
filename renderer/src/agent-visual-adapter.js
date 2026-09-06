// Translates the theme's intent ids (themes/duck/theme.json states) into DuckRuntime commands.
// planForVisual is pure; createBehaviours owns timers so a new visual always cancels the previous one.
export const INTENT_IDS = new Set([
  "duck-idle", "duck-thinking", "duck-working", "duck-juggling", "duck-carrying", "duck-sweeping",
  "duck-attention", "duck-notification", "duck-error", "duck-sleeping", "duck-waking", "duck-roam",
]);

import { FACING_HALF_CONE } from "./runtime/gestures.js";

const SYSTEM = "system";

export function planForVisual(file) {
  switch (file) {
    case "duck-roam": return { kind: "roam", forward: ROAM_FORWARD, periodMs: 2000 };
    case "duck-thinking": return { kind: "look", everyMs: 1500 };
    case "duck-working": return { kind: "walk", forward: 0.7, heading: 0, periodMs: 2000 };
    case "duck-juggling": return { kind: "sweep", forward: 0.8, amplitude: 0.8, periodMs: 3000 };
    case "duck-carrying": return { kind: "peck", everyMs: 0 };
    // Compacting can run for minutes: stay busy (walk in place) and only
    // peck now and then, instead of pecking non-stop for the whole time.
    case "duck-sweeping": return { kind: "look", everyMs: 1500, peckEveryMs: 10000 };
    case "duck-attention": return { kind: "face", quackEveryMs: 0 };
    case "duck-notification": return { kind: "face", quackEveryMs: 2500 };
    case "duck-error": return { kind: "sulk" };
    case "duck-sleeping": return { kind: "sleep" };
    case "duck-waking": return { kind: "wake" };
    default: return { kind: "idle" };
  }
}

const rand = (a, b) => a + Math.random() * (b - a);

// Roam walks at the edge of the camera-facing cone (±60°, never showing its
// back) so most of the stride is sideways; main slides the window by that
// stride and adds the walk's planned up/down drift in step with it. 0.6 is
// the slowest command the walking policy reliably starts from standstill
// with (0.45 only sustains a gait already under way).
export const ROAM_FORWARD = 0.6;

export function createBehaviours({ runtime, autonomy, clock = globalThis }) {
  let timers = [];
  let current = "duck-idle";
  let roamLeft = null; // last roam-heading from main; null until the first roam
  const roamHeading = () => (roamLeft ? 1 : -1) * FACING_HALF_CONE;
  const cmd = (intent) => runtime.command({ source: SYSTEM, ...intent });
  const every = (ms, fn) => { fn(); timers.push(clock.setInterval(fn, ms)); };
  const stopTimer = () => { for (const t of timers) clock.clearInterval(t); timers = []; };

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
        if (plan.peckEveryMs > 0) every(plan.peckEveryMs, () => cmd({ type: "perform", action: "peck" }));
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
