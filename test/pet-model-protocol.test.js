const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { POLICY_NAMES, resolvePolicyRequest, policyDirectory } = require("../src/pet-model-protocol");

test("policy directory points at the pinned simulator commit in the HF cache", () => {
  const dir = policyDirectory("/home/u");
  assert.equal(dir, path.join("/home/u", ".cache", "huggingface", "microduck-simulator",
    "183f99a40bd7308da3e848de961ed32bb02624a5", "policies"));
});

test("only whitelisted policy names resolve", () => {
  assert.deepEqual([...POLICY_NAMES].sort(), ["BEST_alpha_sitstand.onnx", "BEST_alpha_stand.onnx", "BEST_alpha_walking.onnx", "BEST_roller.onnx", "BEST_roller_crouch.onnx", "alpha_ground_pick.onnx"]);
  const ok = resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => true });
  assert.equal(ok.status, 200);
  assert.ok(ok.file.endsWith(path.join("policies", "BEST_alpha_walking.onnx")));
  assert.equal(resolvePolicyRequest("pet-model://policy/evil.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/..%2F..%2Fx.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => false }).status, 404);
});

test("stilt policies resolve to the pinned Hub snapshot in the HF cache", () => {
  const { resolvePolicyRequest, STILTS_COMMIT } = require("../src/pet-model-protocol");
  const ok = resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: () => true });
  assert.equal(ok.status, 200);
  assert.equal(ok.file, `/home/u/.cache/huggingface/hub/models--HannesVonEssen--microduck-stilts/snapshots/${STILTS_COMMIT}/25cm/policy.onnx`);
  assert.equal(resolvePolicyRequest("pet-model://policy/stilts%2F30cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fcheckpoint.pt", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: () => false }).status, 404);
});

test("the official roller policies resolve from the simulator cache", () => {
  const { resolvePolicyRequest, POLICY_COMMIT } = require("../src/pet-model-protocol");
  for (const name of ["BEST_roller.onnx", "BEST_roller_crouch.onnx"]) {
    const ok = resolvePolicyRequest(`pet-model://policy/${name}`, { homeDir: "/home/u", exists: () => true });
    assert.equal(ok.status, 200);
    assert.equal(ok.file, `/home/u/.cache/huggingface/microduck-simulator/${POLICY_COMMIT}/policies/${name}`);
  }
});
