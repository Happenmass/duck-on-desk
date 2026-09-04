"use strict";

function checkPrefsReadability(options = {}) {
  if (options.recoveryBackupFailed === true) {
    return {
      id: "prefs-readability",
      status: "critical",
      level: "critical",
      reason: "prefs-recovery-backup-failed",
      detail: "Invalid preferences could not be backed up, so the original file was kept unchanged. Settings writes, agent events, and approvals are paused. Repair or move duck-prefs.json, then restart Duck.",
    };
  }
  if (options.readFailure === true) {
    return {
      id: "prefs-readability",
      status: "critical",
      level: "critical",
      reason: "prefs-read-failure",
      detail: "The preferences file could not be read. Agent events and approvals are paused to protect the existing file. Restore file access, then restart Duck.",
    };
  }
  if (options.recovered === true) {
    return {
      id: "prefs-readability",
      status: "critical",
      level: "critical",
      reason: "prefs-recovered",
      detail: "Preferences were recovered from invalid contents and the original was backed up as duck-prefs.json.bak. Agent events and approvals are paused for this launch. Review Settings, then restart Duck.",
    };
  }
  return {
    id: "prefs-readability",
    status: "pass",
    level: null,
    detail: "Preferences are readable and authoritative.",
  };
}

module.exports = { checkPrefsReadability };
