const test = require("node:test");
const assert = require("node:assert/strict");

test("auditCodexHooks finds the six managed events", async () => {
  const { auditCodexHooks, CODEX_EVENTS } = await import("../scripts/check-codex-hooks.mjs");
  const hooksJson = { hooks: Object.fromEntries(CODEX_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: "/home/me/.codex/duck-hooks/codex-hook.js.sh " + e }] }]])) };
  const report = auditCodexHooks(hooksJson);
  assert.deepEqual(report.managedEvents, CODEX_EVENTS);
  assert.deepEqual(report.missingEvents, []);
});
