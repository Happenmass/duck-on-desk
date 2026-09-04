const PRIORITY = Object.freeze({ autonomy: 10, mcp: 50, system: 90, local: 100 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export class MotionLeases {
  #records = new Map();
  #sequence = 0;

  set(source, motion, { ttlMs = Infinity, now = performance.now() } = {}) {
    if (!(source in PRIORITY)) throw new Error(`unknown motion source: ${source}`);
    const expiresAt = Number.isFinite(ttlMs) ? now + Math.max(0, ttlMs) : Infinity;
    this.#records.set(source, {
      source,
      forward: clamp(motion.forward, -1, 1),
      turn: clamp(motion.turn, -1, 1),
      // Optional facing target (rad, relative to the camera); overrides turn.
      heading: typeof motion.heading === "number" ? clamp(motion.heading, -Math.PI, Math.PI) : undefined,
      expiresAt,
      sequence: ++this.#sequence,
    });
  }

  clear(source) {
    this.#records.delete(source);
  }

  clearAll() {
    this.#records.clear();
  }

  current(now = performance.now()) {
    for (const [source, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(source);
    }
    let winner = null;
    for (const record of this.#records.values()) {
      if (!winner || PRIORITY[record.source] > PRIORITY[winner.source] ||
          (PRIORITY[record.source] === PRIORITY[winner.source] && record.sequence > winner.sequence)) {
        winner = record;
      }
    }
    if (!winner) return { source: null, forward: 0, turn: 0 };
    const motion = { source: winner.source, forward: winner.forward, turn: winner.turn };
    if (winner.heading !== undefined) motion.heading = winner.heading;
    return motion;
  }
}
