// Idle repertoire when nobody is touching the duck. Weights sum to 1;
// `roll` is a [0,1) sample so the choice is testable without Math.random.
// Main owns locomotion through duck-roam. An idle move would animate the
// feet while pet-bridge discards its displacement and the window stays put.
export const IDLE_ACTIONS = [["look", 0.80], ["peck", 0.12], ["quack", 0.08]];
export function chooseIdleAction(roll = Math.random()) {
  let acc = 0;
  for (const [name, weight] of IDLE_ACTIONS) if (roll < (acc += weight)) return name;
  return IDLE_ACTIONS[IDLE_ACTIONS.length - 1][0];
}

const rand = (a, b) => a + Math.random() * (b - a);
export const GLANCE_MIN_MS = 700;
export const GLANCE_MAX_MS = 1_800;

export class AutonomyAdapter {
  #runtime;
  #timer;
  #lastHumanAt = performance.now();
  #nextActionAt = performance.now() + 6_000;
  #nextGlanceAt = performance.now() + 1_000;
  #holdHeadUntil = 0; // a deliberate "look" keeps its pose until then
  #paused = false;

  // Sleep is not decided here: main's inactivity timer puts the duck to sleep
  // through the `sleeping` state (and blocks free roam while it lasts), so the
  // renderer never dozes off on its own only to be walked awake by main.
  constructor(runtime) {
    this.#runtime = runtime;
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
    const snapshot = this.#runtime.snapshot();
    if (snapshot.busy) return;
    // Between the bigger idle actions the head keeps glancing about every
    // second or so (small, quick moves) so a resting duck never reads as a
    // frozen frame; a deliberate look holds its pose for its own duration.
    if (now >= this.#nextGlanceAt && now >= this.#holdHeadUntil && !snapshot.sleeping) {
      this.#runtime.command({
        type: "look", source: "autonomy",
        headYaw: rand(-0.4, 0.4), headPitch: rand(-0.18, 0.18), neckPitch: rand(-0.12, 0.12), headRoll: rand(-0.1, 0.1),
      });
      this.#nextGlanceAt = now + rand(GLANCE_MIN_MS, GLANCE_MAX_MS);
    }
    if (now < this.#nextActionAt) return;
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
        const hold = rand(1_200, 3_500);
        this.#holdHeadUntil = performance.now() + hold;
        return hold;
      }
      case "peck":
        cmd({ type: "perform", action: "peck" });
        return 2_800 + rand(3_000, 6_000);
      case "quack":
        cmd({ type: "perform", action: "quack" });
        return rand(1_500, 3_000);
    }
  }
}
