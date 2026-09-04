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
  assert.deepEqual([...POLICY_NAMES].sort(), ["BEST_alpha_sitstand.onnx", "BEST_alpha_stand.onnx", "BEST_alpha_walking.onnx", "alpha_ground_pick.onnx"]);
  const ok = resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => true });
  assert.equal(ok.status, 200);
  assert.ok(ok.file.endsWith(path.join("policies", "BEST_alpha_walking.onnx")));
  assert.equal(resolvePolicyRequest("pet-model://policy/evil.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/..%2F..%2Fx.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => false }).status, 404);
});
