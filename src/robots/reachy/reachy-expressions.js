"use strict";

// Physical expressions for a connected Reachy Mini. Every move here is a
// recorded move the daemon already ships: it owns the trajectory and its own
// sound, so this module only decides *which* one and *when*. Nothing is
// synthesized, nothing is sent as a pose target, and the renderer is untouched —
// it mirrors the feedback the move produces.
const EMOTIONS = "pollen-robotics/reachy-mini-emotions-library";
const DANCES = "pollen-robotics/reachy-mini-dances-library";
const DATASETS = [EMOTIONS, DANCES];

// Repeated while the state persists, at a random interval in [min, max] ms.
// Screened on the robot 2026-09-06 (durations from the daemon log): dances are
// 2-3 s and silent, emotions 3-8 s with their own sound. Dropped: curious1 and
// understanding1/yes1 (IK collision warnings on this unit), waiting/boredom1/
// boredom2 (11-17 s, too long for a random insert).
const PERIODIC = {
  idle: {
    moves: [[EMOTIONS, "attentive1"], [EMOTIONS, "attentive2"], [EMOTIONS, "thoughtful1"], [EMOTIONS, "thoughtful2"], [EMOTIONS, "calming1"], [EMOTIONS, "serenity1"],
      [DANCES, "side_to_side_sway"], [DANCES, "head_tilt_roll"], [DANCES, "pendulum_swing"], [DANCES, "simple_nod"], [DANCES, "side_glance_flick"]],
    min: 45000, max: 90000,
  },
  thinking: {
    moves: [[EMOTIONS, "inquiring1"], [EMOTIONS, "inquiring2"], [EMOTIONS, "inquiring3"], [EMOTIONS, "uncertain1"], [EMOTIONS, "incomprehensible2"], [DANCES, "uh_huh_tilt"]],
    min: 40000, max: 70000,
  },
  working: {
    moves: [[EMOTIONS, "helpful1"], [EMOTIONS, "helpful2"], [DANCES, "yeah_nod"], [DANCES, "chin_lead"], [DANCES, "uh_huh_tilt"]],
    min: 60000, max: 90000,
  },
};
// Once, when the state is entered. Every other state (carrying, juggling,
// roam, sleeping, waking, mini-*) stays physically quiet. sweeping is context
// compaction: tired1 ("you yawn... between tasks, especially after working
// hard", 7.4 s) is reserved for it and kept out of the idle rotation.
const ON_ENTRY = {
  notification: [EMOTIONS, "surprised1"],
  attention: [EMOTIONS, "enthusiastic1"],
  error: [EMOTIONS, "oops2"],
  sweeping: [EMOTIONS, "tired1"],
};
// A move must not tread on the previous one, and a fresh connection is busy
// reconciling its own lifecycle.
const GAP_MS = 8000;
const AFTER_CONNECT_MS = 5000;

function createReachyExpressions({ client, settings, isReachySelected, isSleepIntended, now = Date.now, random = Math.random }) {
  let timer = null, state = null, generation = null, available = null;
  let lastFinished = 0, connectedAt = 0, running = false, disposed = false;

  const stop = () => { clearTimeout(timer); timer = null; };
  const enabled = () => !disposed && settings.get("reachyExpressions") !== false && isReachySelected();

  // Checked immediately before every play, never only at scheduling time: the
  // robot may have gone to sleep, been claimed by a lifecycle move, or dropped
  // while the timer was pending.
  const eligible = () => {
    if (!enabled() || running || isSleepIntended()) return false;
    if (client.generation !== generation) return false;
    const snapshot = client.snapshot();
    if (!snapshot.connected || !snapshot.motionEnabled || snapshot.sleeping || snapshot.motionState) return false;
    const at = now();
    return at - lastFinished >= GAP_MS && at - connectedAt >= AFTER_CONNECT_MS;
  };

  // A robot may have a different set of libraries installed than the one this
  // mapping was written against; only names the daemon actually lists are used.
  const pick = moves => {
    const usable = moves.filter(([dataset, name]) => available?.get(dataset)?.includes(name));
    return usable.length ? usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))] : null;
  };

  const play = async move => {
    if (!move) return;
    running = true;
    // The client serializes this behind any pending wake/sleep, so an
    // expression can never overlap one; a failure is decoration failing, not a
    // lifecycle error, and must not raise the robot error dialog.
    try { await client.playRecordedMove(move[0], move[1]); } catch { /* decorative */ }
    finally { running = false; lastFinished = now(); }
  };

  const schedule = () => {
    stop();
    const plan = PERIODIC[state];
    if (!plan || !enabled()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!eligible()) return schedule();
      void play(pick(plan.moves)).then(schedule);
    }, plan.min + Math.floor(random() * (plan.max - plan.min)));
    timer.unref?.();
  };

  const loadDatasets = async which => {
    for (const dataset of DATASETS) {
      // A dataset that fails to list is simply unavailable for this connection.
      let names = [];
      try { names = await client.listRecordedMoves(dataset); } catch { names = []; }
      if (disposed || client.generation !== which) return;
      available.set(dataset, names);
    }
  };

  return {
    // The committed semantic state. `initial` seeds the schedule after a
    // restart without replaying the entry expression of a historical state.
    handleState(next, options = {}) {
      if (next === state) return;
      state = next;
      schedule();
      const move = options.initial === true ? null : ON_ENTRY[next];
      const picked = move && eligible() ? pick([move]) : null;
      if (picked) void play(picked).then(schedule);
      // The move carries its own official sound; the caller skips its cue so
      // the robot voices an event exactly once.
      return !!picked;
    },
    onStatus(status) {
      if (disposed) return;
      if (!status.connected) { generation = null; available = null; stop(); return; }
      if (generation === client.generation) return;
      // One listing per physical connection, cached against its generation.
      generation = client.generation;
      connectedAt = now();
      available = new Map();
      void loadDatasets(generation);
      schedule();
    },
    // Robot switch, auto-connect toggle, host change or the pref itself.
    refresh: schedule,
    dispose() { disposed = true; stop(); },
  };
}

module.exports = { createReachyExpressions, PERIODIC, ON_ENTRY, DATASETS, EMOTIONS, DANCES, GAP_MS, AFTER_CONNECT_MS };
