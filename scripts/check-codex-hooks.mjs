#!/usr/bin/env node
// Audits ~/.codex/hooks.json for duck-on-desk managed hooks. Read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop"];
const MARKER = /codex-hook\.js/;

export function auditCodexHooks(json) {
  const hooks = (json && json.hooks) || {};
  const managedEvents = [];
  for (const event of CODEX_EVENTS) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    const managed = entries.some((entry) => (entry.hooks || []).some((h) => MARKER.test(String(h.command || ""))));
    if (managed) managedEvents.push(event);
  }
  return { managedEvents, missingEvents: CODEX_EVENTS.filter((e) => !managedEvents.includes(e)) };
}

// pathToFileURL, not `file://${argv[1]}`: a repo path with non-ASCII characters or
// spaces is percent-encoded in import.meta.url, so the raw string never matches.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "hooks.json");
  const report = auditCodexHooks(JSON.parse(fs.readFileSync(file, "utf8")));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.missingEvents.length === 0 ? 0 : 1);
}
