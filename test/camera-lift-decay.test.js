const test = require("node:test");
const assert = require("node:assert/strict");

// The camera rig's ease-down after a landing used to be a flat `lift * 0.75`
// applied once per rendered frame. That reads as a fixed feel only if the
// render loop runs at one fixed rate: capping the loop from the display's
// 120 Hz to 30 fps stretched the settle from ~80 ms to ~330 ms, which shows up
// as the duck sitting visibly low in the window after being dropped. These
// tests pin the decay to elapsed time so the frame rate cannot change it.

test("cameraLiftDecay settles on the same wall-clock curve at any frame rate", async () => {
  const { cameraLiftDecay } = await import("../renderer/src/runtime/gestures.js");

  // Run 120 ms of decay from the same start, stepped at three frame rates.
  const settleAfter = (frameMs) => {
    let lift = 0.15;
    for (let elapsed = 0; elapsed < 120; elapsed += frameMs) lift = cameraLiftDecay(lift, frameMs);
    return lift;
  };
  const at120 = settleAfter(1000 / 120);
  const at60 = settleAfter(1000 / 60);
  const at30 = settleAfter(1000 / 30);

  // All three land within a hair of each other; the old per-frame constant put
  // them orders of magnitude apart (0.75**14 vs 0.75**3 == 0.018 vs 0.42).
  for (const [label, value] of [["60 Hz", at60], ["30 Hz", at30]]) {
    assert.ok(
      Math.abs(value - at120) < 0.002,
      `${label} decayed to ${value}, expected within 0.002 of the 120 Hz result ${at120}`,
    );
  }
});

test("cameraLiftDecay reproduces the original 0.75-per-frame feel at 120 Hz", async () => {
  const { cameraLiftDecay } = await import("../renderer/src/runtime/gestures.js");
  // One 120 Hz frame must still shrink the lift by the factor the value was
  // tuned at, so the change is a fix for other frame rates, not a retune.
  assert.ok(Math.abs(cameraLiftDecay(1, 1000 / 120) - 0.75) < 0.01);
});

test("cameraLiftDecay is monotonic, never negative, and ignores a zero step", async () => {
  const { cameraLiftDecay } = await import("../renderer/src/runtime/gestures.js");
  assert.equal(cameraLiftDecay(0.2, 0), 0.2); // two callbacks in the same millisecond
  assert.equal(cameraLiftDecay(0, 33), 0);
  assert.ok(cameraLiftDecay(0.2, 33) < 0.2);
  assert.ok(cameraLiftDecay(0.2, 33) > 0);
  // A long stall (tab throttled, window occluded) collapses the lift rather
  // than leaving the camera parked high.
  assert.ok(cameraLiftDecay(0.2, 5000) < 1e-6);
});
