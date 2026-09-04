#!/usr/bin/env node
// Audits ~/.claude/settings.json for duck-on-desk managed hooks. Read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CORE_EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "Stop", "SubagentStart", "SubagentStop", "Notification", "Elicitation"];
const MARKER = "duck-hook.js";
const PERMISSION_URL = /^http:\/\/127\.0\.0\.1:2433[3-7]\/permission$/;

export function auditClaudeSettings(settings) {
  const hooks = (settings && settings.hooks) || {};
  const managedEvents = [];
  let userEntriesPreserved = 0;
  let permissionUrl = null;
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const hook of Array.isArray(entry.hooks) ? entry.hooks : []) {
        if (hook.type === "command" && typeof hook.command === "string" && hook.command.includes(MARKER)) {
          if (!managedEvents.includes(event)) managedEvents.push(event);
        } else if (hook.type === "http" && event === "PermissionRequest" && PERMISSION_URL.test(hook.url || "")) {
          permissionUrl = hook.url;
        } else {
          userEntriesPreserved++;
        }
      }
    }
  }
  const missingEvents = CORE_EVENTS.filter((e) => !managedEvents.includes(e));
  return { managedEvents, missingEvents, permissionUrl, userEntriesPreserved };
}

// pathToFileURL, not `file://${argv[1]}`: a repo path with non-ASCII characters or
// spaces is percent-encoded in import.meta.url, so the raw string never matches.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
  const report = auditClaudeSettings(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.missingEvents.length === 0 && report.permissionUrl ? 0 : 1);
}
