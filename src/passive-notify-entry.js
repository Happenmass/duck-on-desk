"use strict";

// Shared predicate for "passive" notification bubbles — Codex cues that
// carry no HTTP decision channel and must never be treated as an actionable
// permission (Allow/Deny) or an auto-approve target. Extracted so
// permission.js and main.js can't drift by hand-rolling their own exclusion
// list per passive type.
function isPassiveNotifyEntry(permEntry) {
  return !!(permEntry && (
    permEntry.isCodexNotify
    || permEntry.isCodexUserInputNotify
  ));
}

module.exports = { isPassiveNotifyEntry };
