const test = require("node:test");
const assert = require("node:assert/strict");
const prefs = require("../src/prefs");

const REMOVED = ["telegramMigrationLastNotified", "feishuApprovalMigrationLastNotified", "recapEnabled",
  "kimiQuotaCollectionEnabled", "mobilePreviewEnabled", "remoteSsh", "discordPresence", "feishuApproval",
  "slackNotify", "tutorialSeen"];

test("prefs schema no longer carries removed subsystem keys", () => {
  const keys = Object.keys(prefs.SCHEMA);
  for (const k of REMOVED) assert.ok(!keys.includes(k), `schema still has ${k}`);
  assert.equal(prefs.CURRENT_VERSION, 20);
});

test("migrating a v19 prefs file drops removed keys", () => {
  const migrated = prefs.migrate({ version: 19, recapEnabled: true, remoteSsh: { profiles: [] }, size: "P:20" });
  assert.equal(migrated.version, 20);
  assert.ok(!("recapEnabled" in migrated));
  assert.ok(!("remoteSsh" in migrated));
  assert.equal(migrated.size, "P:20");
});
