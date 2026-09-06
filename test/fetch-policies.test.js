const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("fetch-policies plans every official and stilt policy from the pinned sources into the cache", () => {
  const { plan } = require("../scripts/fetch-policies");
  const { POLICY_NAMES, STILT_HEIGHTS_CM, POLICY_COMMIT, STILTS_COMMIT } = require("../src/pet-model-protocol");
  const items = plan({ homeDir: "/home/u" });
  assert.equal(items.length, POLICY_NAMES.size + STILT_HEIGHTS_CM.size);
  for (const item of items) {
    assert.ok(item.url.endsWith(item.rel.split(path.sep).slice(-2).join("/")), item.url);
    assert.ok(item.url.includes(POLICY_COMMIT) || item.url.includes(STILTS_COMMIT), item.url);
    assert.ok(item.cache.startsWith(path.join("/home/u", ".cache", "huggingface")), item.cache);
  }
  assert.ok(items.some((i) => i.rel === "BEST_roller.onnx"));
  assert.ok(items.some((i) => i.rel === path.join("stilts", "25cm", "policy.onnx")));
});
