'use strict';
// Fixtures below are trimmed copies of manifests published under the Hub's
// `microduck-policy` tag (surveyed 2026-09-16). They are kept verbatim in the
// fields that drive classification so the suite fails if the real-world shapes
// stop matching the classifier.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, normalizeEntry, taskId, isZeroIdle, STATUS } = require('../src/market/manifest.js');

const model = (changes = {}) => ({
  id: 'author/microduck-thing',
  sha: 'a'.repeat(40),
  siblings: [{ rfilename: 'policy.onnx' }, { rfilename: 'manifest.json' }],
  tags: ['onnx', 'microduck-policy', 'license:apache-2.0'],
  likes: 3, downloads: 12, lastModified: '2026-08-29T16:43:06.000Z',
  ...changes,
});

const base = (changes = {}) => ({
  schema_version: 2, model_api: 1, obs_len: 61, action_len: 14, action_scale: 1,
  robot: { model: 'microduck', hw_rev: 1, servos: 'xl330', control_hz: 50 },
  ...changes,
});

test('a velocity-tracking gait from a verified task is ready to drive', () => {
  const verdict = classify(base({
    name: 'rough-walk-e', kind: 'perpetual', duration_s: null,
    command: { twist: ['vx: forward velocity command, m/s', 'vy: lateral', 'wz: yaw rate'], idle: [0, 0, 0] },
    training: { task_id: 'Mjlab-Hostile-FinetuneFeetProgress-MicroDuck', repo: 'pollen-robotics/microduck_rl' },
  }));
  assert.equal(verdict.status, STATUS.ready);
  assert.equal(verdict.commandMode, 'velocity');
  assert.equal(verdict.duration, null);
});

test('a gait whose task is not on the verified list stays manual even when it looks official', () => {
  // Same `Mjlab-*-Flat-MicroDuck` shape as the walking tasks, but slot 0 is a
  // mode flag: this is exactly the case name-matching would get wrong.
  const verdict = classify(base({
    name: 'flamingo-cycle', kind: 'perpetual', duration_s: null,
    command: { twist: ['flag: 0 = stand on two feet, 1 = stand on one foot', 'side', 'unused (0)'], idle: [0, 0, 0] },
    training: { task_id: 'Mjlab-FlamingoCycleHard-Flat-MicroDuck' },
  }));
  assert.equal(verdict.status, STATUS.manual);
  assert.equal(verdict.reason, 'command-semantics-unknown');
  assert.equal(verdict.commandMode, null);
});

test('an episodic policy with a declared all-zero idle plays on zero commands', () => {
  const verdict = classify(base({
    name: 'happy-hop', kind: 'episodic', duration_s: 3,
    command: { twist: ['unused (0)', 'unused (0)', 'unused (0)'], idle: [0, 0, 0],
      trigger: 'external one-shot policy switch; the trigger is not encoded in the observation' },
    training: { task_id: 'Mjlab-HappyHop-WalkTransition-Clearance-Flat-Backlash-MicroDuck' },
  }));
  assert.equal(verdict.status, STATUS.ready);
  assert.equal(verdict.commandMode, 'zero-commands');
  assert.equal(verdict.duration, 3);
});

test('an episodic policy that declares no idle vector is not assumed to take zeros', () => {
  // This app's own ground pick is phase-driven -- [cos, sin, 0] in the velocity
  // slots (renderer/src/runtime/duck-runtime.js) -- so feeding zeros to an
  // episodic policy is a guess, not a default.
  const verdict = classify(base({ name: 'ground-pick', kind: 'episodic', duration_s: 2.8, command: { twist: 'unused (zeros)' } }));
  assert.equal(verdict.status, STATUS.manual);
  assert.equal(verdict.reason, 'episodic-command-unknown');
  assert.equal(verdict.duration, 2.8);
});

test('durations outside the playable range do not qualify as episodic actions', () => {
  for (const duration_s of [0, -1, 120, Number.NaN, '3']) {
    const verdict = classify(base({ kind: 'episodic', duration_s, command: { idle: [0, 0, 0] } }));
    assert.equal(verdict.status, STATUS.manual, `duration ${duration_s}`);
    assert.equal(verdict.duration, null);
  }
});

test('an unknown or absent model_api is unverifiable rather than rejected', () => {
  const missing = classify(base({ model_api: undefined, kind: 'perpetual' }));
  assert.equal(missing.status, STATUS.unverifiable);
  assert.equal(missing.reason, 'model-api-missing');
  // model_api 2 already exists on the Hub; a newer contract is not a broken one.
  const newer = classify(base({ model_api: 2, kind: 'perpetual' }));
  assert.equal(newer.status, STATUS.unverifiable);
  assert.equal(newer.reason, 'model-api-unsupported');
  assert.equal(classify(null).reason, 'no-manifest');
});

test('a qualified body is listed but never one-click, and another robot is refused', () => {
  const rollers = classify(base({ robot: { model: 'microduck passive rollers', control_hz: 50 }, kind: 'perpetual' }));
  assert.equal(rollers.status, STATUS.manual);
  assert.equal(rollers.reason, 'foreign-morphology');
  const shell = classify(base({ robot: { model: 'microduck full_shell', control_hz: 50 }, kind: 'perpetual' }));
  assert.equal(shell.status, STATUS.manual);
  assert.equal(shell.reason, 'body-variant');
  const other = classify(base({ robot: { model: 'reachy mini', control_hz: 50 } }));
  assert.equal(other.status, STATUS.incompatible);
  assert.equal(other.reason, 'other-robot');
});

test('a declared contract that disagrees with the runtime is a hard stop', () => {
  assert.equal(classify(base({ obs_len: 48 })).reason, 'observation-size');
  assert.equal(classify(base({ action_len: 12 })).reason, 'action-size');
  assert.equal(classify(base({ robot: { model: 'microduck', control_hz: 100 } })).reason, 'control-rate');
  // An absent shape only means this author's schema omits it.
  assert.notEqual(classify(base({ obs_len: undefined, action_len: undefined, kind: 'perpetual' })).status, STATUS.incompatible);
});

test('lineage prose after the task identifier is ignored', () => {
  assert.equal(
    taskId({ training: { task_id: 'Mjlab-Hostile-FinetuneFeetProgress-MicroDuck (continuation of Mjlab-Hostile-ScratchFeetProgress-MicroDuck)' } }),
    'Mjlab-Hostile-FinetuneFeetProgress-MicroDuck');
  // Authors use `task` as well as `task_id`.
  assert.equal(taskId({ training: { task: 'Mjlab-BallKick-Flat-MicroDuck' } }), 'Mjlab-BallKick-Flat-MicroDuck');
  assert.equal(taskId({ training: {} }), null);
  assert.equal(taskId({}), null);
});

test('isZeroIdle rejects the shapes that are not a declared zero vector', () => {
  assert.equal(isZeroIdle([0, 0, 0]), true);
  assert.equal(isZeroIdle([0, 1, 0]), false);
  assert.equal(isZeroIdle([]), false);
  assert.equal(isZeroIdle(undefined), false);
  assert.equal(isZeroIdle('0,0,0'), false);
});

test('a repository without policy.onnx or without a revision cannot be used', () => {
  const noPolicy = normalizeEntry(model({ siblings: [{ rfilename: 'README.md' }] }), base());
  assert.equal(noPolicy.status, STATUS.incompatible);
  assert.equal(noPolicy.reason, 'no-policy-file');
  assert.equal(noPolicy.policyPath, null);
  const noSha = normalizeEntry(model({ sha: 'not-a-sha' }), base());
  assert.equal(noSha.reason, 'no-revision');
  assert.equal(noSha.sha, null);
});

test('listing metadata is carried through for display', () => {
  const entry = normalizeEntry(model({
    siblings: [{ rfilename: 'policy.onnx' }, { rfilename: 'manifest.json' }, { rfilename: 'media/preview.mp4' }, { rfilename: 'poster.jpg' }],
  }), base({
    name: 'happy-hop', description: 'Short vertical two-foot hop.', kind: 'episodic', duration_s: 3,
    entry_pose: 'standing', command: { idle: [0, 0, 0] },
    training: { task_id: 'Mjlab-HappyHop-Flat-MicroDuck', repo: 'pollen-robotics/microduck_rl' },
    eval: { known_limits: 'never tested on hardware' }, poster: 'poster.jpg',
  }));
  assert.equal(entry.owner, 'author');
  assert.equal(entry.slug, 'microduck-thing');
  assert.equal(entry.title, 'happy-hop');
  assert.equal(entry.license, 'apache-2.0');
  assert.equal(entry.mediaPath, 'media/preview.mp4');
  assert.equal(entry.posterPath, 'poster.jpg');
  assert.equal(entry.entryPose, 'standing');
  assert.equal(entry.trainingRepo, 'pollen-robotics/microduck_rl');
  assert.equal(entry.knownLimits, 'never tested on hardware');
  assert.equal(entry.likes, 3);
  assert.equal(entry.downloads, 12);
  assert.equal(entry.hasManifest, true);
});

test('a repository with no manifest still lists, with its title from the slug', () => {
  const entry = normalizeEntry(model(), null);
  assert.equal(entry.status, STATUS.unverifiable);
  assert.equal(entry.reason, 'no-manifest');
  assert.equal(entry.title, 'microduck-thing');
  assert.equal(entry.hasManifest, false);
});

test('a listing entry without a usable repository name is dropped', () => {
  assert.equal(normalizeEntry({ id: 'no-slash' }, base()), null);
  assert.equal(normalizeEntry({}, base()), null);
  assert.equal(normalizeEntry(null, base()), null);
});
