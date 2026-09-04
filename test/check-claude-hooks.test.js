const test = require("node:test");
const assert = require("node:assert/strict");

test("auditClaudeSettings reports managed events and the permission url", async () => {
  const { auditClaudeSettings } = await import("../scripts/check-claude-hooks.mjs");
  const settings = {
    hooks: {
      SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "\"/usr/bin/node\" \"/app/hooks/duck-hook.js\" SessionStart", async: true, timeout: 5 }] }],
      Stop: [{ matcher: "", hooks: [{ type: "command", command: "\"/usr/bin/node\" \"/app/hooks/duck-hook.js\" Stop", async: true, timeout: 5 }] }],
      PermissionRequest: [{ matcher: "", hooks: [{ type: "http", url: "http://127.0.0.1:24333/permission", timeout: 600 }] }],
      PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "/home/me/my-own-hook.sh" }] }],
    },
  };
  const report = auditClaudeSettings(settings);
  assert.deepEqual(report.managedEvents, ["SessionStart", "Stop"]);
  assert.equal(report.permissionUrl, "http://127.0.0.1:24333/permission");
  assert.deepEqual(report.missingEvents, ["SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "SubagentStart", "SubagentStop", "Notification", "Elicitation"]);
  assert.equal(report.userEntriesPreserved, 1);
});
