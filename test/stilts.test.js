const test = require("node:test");
const assert = require("node:assert/strict");

test("stilt loft matches the training geometry: two 32-point rings, tip at -height, root at 0", async () => {
  const { stiltMeshData, stiltMassKg, normalizeStilts, stiltPolicyFile, stiltFraming, STILT_HEIGHTS_CM } = await import("../renderer/src/runtime/stilts.js");
  const { vertices, faces } = stiltMeshData(25);
  assert.equal(vertices.length / 3, 66);
  assert.equal(faces.length, 32 * 4 * 3);
  const zs = Array.from({ length: 66 }, (_, i) => vertices[i * 3 + 2]);
  assert.equal(Math.min(...zs), -0.25);
  assert.equal(Math.max(...zs), 0);
  const xs = (from, to) => Array.from({ length: to - from }, (_, i) => vertices[(from + i) * 3]);
  const ys = (from, to) => Array.from({ length: to - from }, (_, i) => vertices[(from + i) * 3 + 1]);
  // blend 0.5 tip: 17 x 22 mm; root: 22.5 x 31.5 mm
  assert.ok(Math.abs(Math.max(...xs(0, 32)) - 0.0085) < 1e-6 && Math.abs(Math.max(...ys(0, 32)) - 0.011) < 1e-6);
  assert.ok(Math.abs(Math.max(...xs(32, 64)) - 0.01125) < 1e-6 && Math.abs(Math.max(...ys(32, 64)) - 0.01575) < 1e-6);
  assert.ok(Math.abs(stiltMassKg(25) - 0.037) < 1e-9);
  assert.deepEqual([normalizeStilts("25"), normalizeStilts(30), normalizeStilts(undefined)], [25, 0, 0]);
  assert.equal(stiltPolicyFile(25), "stilts/25cm/policy.onnx");
  assert.deepEqual(STILT_HEIGHTS_CM, [10, 15, 20, 25, 50, 100, 140, 200]);
  assert.deepEqual(stiltFraming(0), { dolly: 1, lookY: 0.12 });
  assert.ok(stiltFraming(25).dolly > 1.5 && stiltFraming(25).lookY > 0.25);
});
