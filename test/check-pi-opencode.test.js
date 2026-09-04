const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("auditPiExtension requires the three managed files", async () => {
  const { auditPiExtension } = await import("../scripts/check-pi-opencode.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-"));
  fs.writeFileSync(path.join(dir, "index.ts"), "export default function () {}");
  fs.writeFileSync(path.join(dir, "pi-extension-core.js"), "module.exports = {};");
  fs.writeFileSync(path.join(dir, ".duck-on-desk-managed.json"), JSON.stringify({ app: "duck-on-desk", integration: "pi", managed: true, version: 1 }));
  assert.deepEqual(auditPiExtension(dir), { ok: true, missing: [] });
  fs.rmSync(path.join(dir, "pi-extension-core.js"));
  assert.deepEqual(auditPiExtension(dir), { ok: false, missing: ["pi-extension-core.js"] });
});

test("auditOpencodeConfig finds the plugin entry", async () => {
  const { auditOpencodeConfig } = await import("../scripts/check-pi-opencode.mjs");
  assert.equal(auditOpencodeConfig({ plugin: ["/x/hooks/opencode-plugin/index.js"] }).ok, true);
  assert.equal(auditOpencodeConfig({ plugin: ["/x/other.js"] }).ok, false);
  assert.equal(auditOpencodeConfig({}).ok, false);
});
