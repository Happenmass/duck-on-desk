// Idle repertoire when nobody is touching the duck. Weights sum to 1;
// `roll` is a [0,1) sample so the choice is testable without Math.random.
export const IDLE_ACTIONS = [["look", 0.45], ["wander", 0.35], ["peck", 0.12], ["quack", 0.08]];
export function chooseIdleAction(roll = Math.random()) {
  let acc = 0;
  for (const [name, weight] of IDLE_ACTIONS) if (roll < (acc += weight)) return name;
  return IDLE_ACTIONS[IDLE_ACTIONS.length - 1][0];
}

import { FACING_HALF_CONE } from "../runtime/gestures.js";

const rand = (a, b) => a + Math.random() * (b - a);

export class AutonomyAdapter {
  #runtime;
  #timer;
  #lastHumanAt = performance.now();
  #nextActionAt = performance.now() + 6_000;
  #sleepAfterMs;
  #paused = false;

  constructor(runtime, { sleepAfterMs = 240_000 } = {}) {
    this.#runtime = runtime;
    this.#sleepAfterMs = sleepAfterMs;
    this.#timer = setInterval(() => this.#tick(), 750);
  }

  noteUserActivity() {
    this.#lastHumanAt = performance.now();
    this.#nextActionAt = this.#lastHumanAt + 6_000;
    this.#runtime.command({ type: "stop", source: "autonomy" });
    if (this.#runtime.snapshot().sleeping) this.#runtime.command({ type: "wake", source: "local" });
  }

  pause() {
    this.#paused = true;
    this.#runtime.command({ type: "stop", source: "autonomy" });
  }

  resume() {
    this.#paused = false;
    this.#nextActionAt = performance.now() + 1_500;
  }

  dispose() {
    clearInterval(this.#timer);
    this.#runtime.command({ type: "stop", source: "autonomy" });
  }

  #tick() {
    if (this.#paused) return;
    const now = performance.now();
    if (now - this.#lastHumanAt >= this.#sleepAfterMs) {
      if (!this.#runtime.snapshot().sleeping) this.#runtime.command({ type: "sleep", source: "autonomy" });
      return;
    }
    if (now < this.#nextActionAt || this.#runtime.snapshot().busy) return;
    this.#nextActionAt = now + this.#act(chooseIdleAction());
  }

  // Runs one idle action and returns the cooldown (ms) before the next pick.
  #act(action) {
    const cmd = (intent) => this.#runtime.command({ source: "autonomy", ...intent });
    switch (action) {
      case "look": {
        // Bird-like glances: snap to a random target, sometimes back to neutral.
        const neutral = Math.random() < 0.3;
        cmd({
          type: "look",
          neckPitch: neutral ? 0 : rand(-0.35, 0.35),
          headPitch: neutral ? 0 : rand(-0.3, 0.3),
          headYaw: neutral ? 0 : rand(-0.7, 0.7),
          headRoll: neutral ? 0 : rand(-0.25, 0.25),
        });
        return rand(1_200, 3_500);
      }
      case "peck":
        cmd({ type: "perform", action: "peck" });
        return 2_800 + rand(3_000, 6_000);
      case "quack":
        cmd({ type: "perform", action: "quack" });
        return rand(1_500, 3_000);
      default: {
        // Sweep inside the camera-facing cone: aim at the side opposite the
        // current facing so the duck turns through the viewer, never away.
        const facing = this.#runtime.snapshot().facing ?? 0;
        const heading = (facing > 0 ? -1 : 1) * rand(0.2, FACING_HALF_CONE - 0.2);
        const duration = rand(3_000, 5_000);
        cmd({ type: "move", forward: rand(0.6, 0.9), heading, ttlMs: duration });
        return duration + rand(4_000, 8_000);
      }
    }
  }
}
