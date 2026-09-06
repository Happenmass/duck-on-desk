"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReachyExpressions, PERIODIC, ON_ENTRY, EMOTIONS, DANCES } = require("../src/robots/reachy/reachy-expressions");

// Every move below is a recorded move the daemon already ships; the tables are
// the contract with the robot, so they are asserted literally.
const LIBRARIES = {
  [EMOTIONS]: ["curious1", "attentive1", "attentive2", "thoughtful1", "thoughtful2", "calming1", "serenity1", "inquiring1", "inquiring2", "inquiring3", "uncertain1", "incomprehensible2", "helpful1", "helpful2", "understanding2", "surprised1", "enthusiastic1", "oops2", "tired1", "rage1"],
  [DANCES]: ["simple_nod", "side_glance_flick", "side_to_side_sway", "head_tilt_roll", "pendulum_swing", "uh_huh_tilt", "yeah_nod", "chin_lead", "dizzy_spin"],
};
const T0 = 1_700_000_000_000;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

// Several instances can share one test's clock; enabling it twice is an error.
const clocked = new WeakSet();
// No fetch, no socket, no device: the module only ever calls these two methods.
function harness(t, { values = {}, libraries = LIBRARIES, listFails = [], randoms = [] } = {}) {
  if (!clocked.has(t)) { clocked.add(t); t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 }); }
  const played = [], listed = [];
  const prefs = { petRobot: "reachy-mini", reachyExpressions: true, ...values };
  let releasePlay = null;
  const client = {
    generation: 1,
    connected: true, motionEnabled: true, sleeping: false, motionState: null,
    snapshot: () => ({ connected: client.connected, motionEnabled: client.motionEnabled, sleeping: client.sleeping, motionState: client.motionState, url: "http://robot:8000" }),
    async listRecordedMoves(dataset) {
      listed.push(dataset);
      if (listFails.includes(dataset)) throw new Error(`GET list/${dataset} failed: HTTP 404`);
      return libraries[dataset] || [];
    },
    async playRecordedMove(dataset, name) {
      played.push(`${dataset}/${name}`);
      if (releasePlay) await new Promise(resolve => { releasePlay = resolve; });
    },
  };
  let desiredSleeping = false;
  const queue = [...randoms];
  const expressions = createReachyExpressions({
    client,
    settings: { get: key => prefs[key] },
    isReachySelected: () => prefs.petRobot === "reachy-mini",
    isSleepIntended: () => desiredSleeping,
    random: () => (queue.length ? queue.shift() : 0),
  });
  t.after(() => expressions.dispose());
  return {
    client, played, listed, expressions, prefs,
    setSleepIntent: value => { desiredSleeping = value; },
    holdNextPlay: () => { releasePlay = () => {}; },
    connect: async () => { expressions.onStatus(client.snapshot()); await settle(); },
    tick: async ms => { t.mock.timers.tick(ms); await settle(); },
  };
}

test("the mapping is exactly the states with a physical expression", () => {
  assert.deepEqual(Object.keys(PERIODIC), ["idle", "thinking", "working"]);
  assert.deepEqual(PERIODIC.idle.moves.map(m => m[1]), ["attentive1", "attentive2", "thoughtful1", "thoughtful2", "calming1", "serenity1", "side_to_side_sway", "head_tilt_roll", "pendulum_swing", "simple_nod", "side_glance_flick"], "curious1 clips the body shell and is out; waiting/boredom are too long");
  assert.deepEqual(PERIODIC.thinking.moves.map(m => m[1]), ["inquiring1", "inquiring2", "inquiring3", "uncertain1", "incomprehensible2", "uh_huh_tilt"]);
  assert.deepEqual(PERIODIC.working.moves.map(m => m[1]), ["helpful1", "helpful2", "yeah_nod", "chin_lead", "uh_huh_tilt"], "understanding1 and yes1 trip IK collision warnings");
  assert.deepEqual([PERIODIC.idle.min, PERIODIC.idle.max], [45000, 90000]);
  assert.deepEqual([PERIODIC.thinking.min, PERIODIC.thinking.max], [40000, 70000]);
  assert.deepEqual([PERIODIC.working.min, PERIODIC.working.max], [60000, 90000]);
  assert.deepEqual(ON_ENTRY, { notification: [EMOTIONS, "surprised1"], attention: [EMOTIONS, "enthusiastic1"], error: [EMOTIONS, "oops2"], sweeping: [EMOTIONS, "tired1"] }, "compaction gets its own move");
  // Locomotion, lifecycle and mini states stay physically quiet.
  for (const state of ["carrying", "juggling", "roam", "sleeping", "waking", "mini-idle", "mini-alert", "mini-sleep"]) {
    assert.equal(PERIODIC[state], undefined, state);
    assert.equal(ON_ENTRY[state], undefined, state);
  }
});

test("a persistent state repeats an expression inside its own interval", async t => {
  const h = harness(t, { randoms: [0] });
  await h.connect();
  h.expressions.handleState("idle");
  await h.tick(44999);
  assert.deepEqual(h.played, [], "never earlier than the low end of the range");
  await h.tick(1);
  assert.deepEqual(h.played, [`${EMOTIONS}/attentive1`]);

  const late = harness(t, { randoms: [0.99999, 0] });
  await late.connect();
  late.expressions.handleState("thinking");
  await late.tick(69999);
  assert.deepEqual(late.played, [`${EMOTIONS}/inquiring1`], "and never later than the high end");
});

test("a state change reschedules, and only mapped states are scheduled at all", async t => {
  const h = harness(t, { randoms: [0, 0, 0, 0] });
  await h.connect();
  h.expressions.handleState("idle");
  await h.tick(44000);
  h.expressions.handleState("working");
  await h.tick(44000);
  assert.deepEqual(h.played, [], "the idle timer does not survive the state it belonged to");
  await h.tick(16000);
  assert.deepEqual(h.played, [`${EMOTIONS}/helpful1`]);

  h.expressions.handleState("juggling");
  await h.tick(200000);
  assert.equal(h.played.length, 1, "an unmapped state schedules nothing");
});

test("an entry expression fires once, and never for a seeded initial state", async t => {
  const h = harness(t);
  await h.connect();
  await h.tick(5000);
  h.expressions.handleState("error", { initial: true });
  await settle();
  assert.deepEqual(h.played, [], "a state seeded after a restart is history, not an event");

  h.expressions.handleState("notification");
  await settle();
  h.expressions.handleState("notification");
  await settle();
  assert.deepEqual(h.played, [`${EMOTIONS}/surprised1`], "re-committing the same state is not a new entry");
});

test("every gate is re-checked immediately before the move", async t => {
  const cases = {
    "pref off": h => { h.prefs.reachyExpressions = false; },
    "another robot": h => { h.prefs.petRobot = "duck"; },
    disconnected: h => { h.client.connected = false; },
    "motors disabled": h => { h.client.motionEnabled = false; },
    sleeping: h => { h.client.sleeping = true; },
    "a lifecycle move is running": h => { h.client.motionState = "goto_sleep"; },
    "sleep is intended": h => { h.setSleepIntent(true); },
  };
  for (const [label, breakIt] of Object.entries(cases)) {
    const h = harness(t, { randoms: [0] });
    await h.connect();
    h.expressions.handleState("idle");
    await h.tick(44000);
    breakIt(h);
    await h.tick(1000);
    assert.deepEqual(h.played, [], label);
  }
});

test("expressions keep clear of a fresh connection and of each other", async t => {
  const h = harness(t);
  await h.connect();
  h.expressions.handleState("attention");
  await settle();
  assert.deepEqual(h.played, [], "a connection is busy reconciling its own lifecycle for 5 s");
  await h.tick(5000);
  h.expressions.handleState("error");
  await settle();
  assert.deepEqual(h.played, [`${EMOTIONS}/oops2`]);

  h.expressions.handleState("notification");
  await settle();
  assert.deepEqual(h.played, [`${EMOTIONS}/oops2`], "8 s of quiet after the previous expression");
  await h.tick(7999);
  h.expressions.handleState("attention");
  await settle();
  assert.equal(h.played.length, 1);
  await h.tick(1);
  h.expressions.handleState("notification");
  await settle();
  assert.deepEqual(h.played, [`${EMOTIONS}/oops2`, `${EMOTIONS}/surprised1`]);
});

test("a sleep intent that arrives during an expression stops the next one", async t => {
  const h = harness(t, { randoms: [0, 0, 0] });
  await h.connect();
  h.holdNextPlay();
  h.expressions.handleState("idle");
  await h.tick(45000);
  assert.deepEqual(h.played, [`${EMOTIONS}/attentive1`], "the move is in flight");
  h.setSleepIntent(true);
  h.expressions.handleState("sleeping");
  await h.tick(300000);
  assert.equal(h.played.length, 1, "no expression is queued behind the sleep");
});

test("only moves the connected robot actually lists are played", async t => {
  const h = harness(t, { libraries: { [EMOTIONS]: [], [DANCES]: ["simple_nod"] }, randoms: [0, 0] });
  await h.connect();
  assert.deepEqual(h.listed, [EMOTIONS, DANCES], "one listing per dataset per connection");
  h.expressions.handleState("idle");
  await h.tick(45000);
  assert.deepEqual(h.played, [`${DANCES}/simple_nod`], "none of the emotions are installed on this robot");

  const failed = harness(t, { listFails: [EMOTIONS], randoms: [0, 0] });
  await failed.connect();
  failed.expressions.handleState("thinking");
  await failed.tick(40000);
  assert.deepEqual(failed.played, [`${DANCES}/uh_huh_tilt`], "a dataset that fails to list is disabled, not fatal");

  const none = harness(t, { listFails: [EMOTIONS, DANCES], randoms: [0, 0] });
  await none.connect();
  none.expressions.handleState("idle");
  await none.tick(200000);
  assert.deepEqual(none.played, []);
});

test("a disconnect clears the timers and the next connection re-lists", async t => {
  const h = harness(t, { randoms: [0, 0, 0] });
  await h.connect();
  h.expressions.handleState("idle");
  h.client.connected = false;
  h.expressions.onStatus(h.client.snapshot());
  await h.tick(200000);
  assert.deepEqual(h.played, []);

  h.client.connected = true;
  h.client.generation = 2;
  await h.connect();
  assert.deepEqual(h.listed, [EMOTIONS, DANCES, EMOTIONS, DANCES]);
  await h.tick(45000);
  assert.deepEqual(h.played, [`${EMOTIONS}/attentive1`], "the reconnected robot picks the schedule back up");
});

test("dispose and a pref flip both silence the robot for good", async t => {
  const h = harness(t, { randoms: [0, 0] });
  await h.connect();
  h.expressions.handleState("idle");
  h.prefs.reachyExpressions = false;
  h.expressions.refresh();
  await h.tick(200000);
  assert.deepEqual(h.played, []);
  h.prefs.reachyExpressions = true;
  h.expressions.refresh();
  h.expressions.dispose();
  await h.tick(200000);
  assert.deepEqual(h.played, []);
});

test("handleState reports whether an entry expression took the event", async t => {
  const h = harness(t);
  assert.equal(h.expressions.handleState("notification"), false, "not connected yet: the caller keeps its cue");
  await h.connect();
  await h.tick(5000);
  h.expressions.handleState("idle");
  assert.equal(h.expressions.handleState("error", { initial: true }), false, "seeded history is not an event");
  h.expressions.handleState("idle");
  assert.equal(h.expressions.handleState("notification"), true, "the move (and its official sound) replaces the cue");
  await settle();
  assert.deepEqual(h.played, [`${EMOTIONS}/surprised1`]);
});
