"use strict";

const fs = require("fs");
const path = require("path");

const {
  isAgentEnabled,
  isAgentIntegrationInstalled,
  isAgentPermissionsEnabled,
} = require("../agent-gate");
const { getAgent } = require("../../agents/registry");
const { commandMatchesMarker, findHookCommands } = require("../../hooks/json-utils");
const { getAgentDescriptors } = require("./agent-descriptors");
const {
  commandContainsFragment,
  validateHookCommand,
  validateHookTarget,
} = require("./agent-node-bin-parser");
const { checkCodexHookTrust, checkCodexHooksFeature } = require("./codex-features-check");
const { inspectStableCodexHookCommand } = require("../../hooks/codex-install-utils");
const { validateOpencodeEntry } = require("./opencode-entry-validator");

const REPAIRABLE_AGENT_STATUSES = new Set(["not-connected", "broken-path"]);

function dirExists(fsImpl, dirPath) {
  try {
    return fsImpl.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(fsImpl, filePath) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJson(fsImpl, filePath) {
  // Strip the UTF-8 BOM (U+FEFF). PowerShell `Set-Content -Encoding utf8`
  // and some Notepad saves prepend it; Node's JSON.parse refuses to parse
  // a leading BOM. Without this, a user who hand-edits hooks.json in those
  // tools makes the doctor pane silently flip to config-corrupt while
  // installers (which already strip BOM) keep working — the mismatch makes
  // the offered Fix button useless because clicking it doesn't reproduce
  // the parse error path.
  let raw = fsImpl.readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

// JSONC-aware sibling of readJson for descriptors with configJsonc: true
// (JSONC configs such as opencode.jsonc). Comments and trailing
// commas are LEGAL there — parsing with bare JSON.parse would flip a healthy
// config to "config-corrupt". Genuinely broken files still throw, keeping
// the config-corrupt path meaningful. jsonc-parser is lazy-required so the
// doctor pays for it only when a JSONC agent is actually inspected.
function readJsonc(fsImpl, filePath) {
  let raw = fsImpl.readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  // eslint-disable-next-line global-require
  const { parse } = require("jsonc-parser");
  const errors = [];
  const tree = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length) {
    throw new Error(`invalid JSONC (${errors.length} parse error${errors.length === 1 ? "" : "s"})`);
  }
  return tree;
}

function withAgentBubbleNote(detail, prefs, agentId) {
  // State-only agents (capabilities.permissionApproval === false) never
  // surface a Clawd bubble in the first place, so annotating them as
  // "permission bubbles disabled" would be misleading. Pi is the current
  // example.
  const agent = getAgent(agentId);
  if (agent && agent.capabilities && agent.capabilities.permissionApproval === false) {
    return detail;
  }
  if (!isAgentPermissionsEnabled(prefs, agentId)) {
    return {
      ...detail,
      permissionsEnabled: false,
      permissionBubbleDetail: "permission bubbles disabled for this agent",
    };
  }
  return detail;
}

function getClaudeHookGuardStatus(options) {
  const server = options && options.server;
  if (!server || typeof server.getClaudeHookGuardStatus !== "function") return null;
  try {
    return server.getClaudeHookGuardStatus();
  } catch {
    return null;
  }
}

function getClaudeHookHealthStatus(options) {
  const server = options && options.server;
  if (!server || typeof server.getClaudeHookHealthStatus !== "function") return null;
  try {
    return server.getClaudeHookHealthStatus();
  } catch {
    return null;
  }
}

// Explains *why* Claude Code's hook config hasn't self-healed, using the
// periodic health supervisor's runtime status (#657) — the disk inspector
// above remains the source of truth for whether it's currently broken; this
// only annotates that verdict. Covers not-connected, broken-path,
// source-script-missing, and manual-fix-required per the #657 plan §6.9.
function withClaudeHookGuardNotice(detail, descriptor, options) {
  if (descriptor.agentId !== "claude-code" || !detail) return detail;

  const runtimeHealth = getClaudeHookHealthStatus(options);
  const repairableDisk = REPAIRABLE_AGENT_STATUSES.has(detail.status);

  // Reconcile can never fix a missing source script, so this must never
  // offer a configuration Repair — overriding the status keeps it out of
  // REPAIRABLE_AGENT_STATUSES for the withAgentFixAction() check below.
  if (
    repairableDisk
    && runtimeHealth
    && runtimeHealth.status === "degraded"
    && runtimeHealth.degradedReason === "source-script-missing"
  ) {
    return {
      ...detail,
      status: "source-script-missing",
      level: "warning",
      detail: "The current Clawd installation's Claude hook script is missing. Reinstall or re-extract Clawd to restore automatic hook repair.",
      claudeHookRuntimeStatus: {
        status: runtimeHealth.status,
        degradedReason: runtimeHealth.degradedReason,
        at: runtimeHealth.at || null,
      },
    };
  }

  if (
    (repairableDisk || detail.status === "ok")
    &&
    runtimeHealth
    && runtimeHealth.status === "degraded"
    && (
      runtimeHealth.degradedReason === "env-hook-node-unresolved"
      || runtimeHealth.degradedReason === "env-indirection-unverified"
    )
  ) {
    const unresolvedNode = runtimeHealth.degradedReason === "env-hook-node-unresolved";
    return {
      ...detail,
      status: detail.status === "ok" ? "needs-review" : detail.status,
      level: "warning",
      detail: unresolvedNode
        ? "Clawd preserved an env-indirected Claude hook because settings.env does not provide a usable absolute Node path. Check CLAWD_NODE_BIN, then use Fix."
        : "Clawd found an env-indirected Claude hook but settings.env does not prove that it belongs to Clawd. Review CLAWD_HOOK_PATH before changing it.",
      claudeHookRuntimeStatus: {
        status: runtimeHealth.status,
        degradedReason: runtimeHealth.degradedReason,
        at: runtimeHealth.at || null,
      },
    };
  }

  if (!repairableDisk) return detail;

  const guard = getClaudeHookGuardStatus(options);
  if (guard && guard.type === "suspicious-shrink") {
    return {
      ...detail,
      detail: "Clawd paused automatic Claude hook repair after settings.json shrank during an external rewrite. Use Fix or restart Clawd to reinstall Clawd hooks.",
      claudeHookGuard: {
        type: guard.type,
        at: guard.at || null,
        before: guard.before || null,
        after: guard.after || null,
      },
    };
  }

  if (runtimeHealth && runtimeHealth.status === "guarded") {
    return {
      ...detail,
      detail: "Clawd paused automatic Claude hook repair because settings.json shrank suspiciously. Use Fix or restart Clawd to reinstall Clawd hooks.",
      claudeHookRuntimeStatus: {
        status: runtimeHealth.status,
        issueSignature: runtimeHealth.issueSignature || null,
        at: runtimeHealth.at || null,
      },
    };
  }

  if (runtimeHealth && runtimeHealth.status === "manual-fix-required") {
    return {
      ...detail,
      detail: "Clawd's automatic Claude hook repair failed 3 times in a row and stopped retrying. Use Fix to try once more, or check the hook script manually.",
      claudeHookRuntimeStatus: {
        status: runtimeHealth.status,
        issueSignature: runtimeHealth.issueSignature || null,
        attempt: runtimeHealth.attempt || null,
        message: runtimeHealth.message || null,
        at: runtimeHealth.at || null,
      },
    };
  }

  return detail;
}

function withAgentFixAction(detail, descriptor) {
  if (!descriptor.autoInstall || !REPAIRABLE_AGENT_STATUSES.has(detail.status)) return detail;
  if (detail.supplementary && detail.supplementary.key === "hook_group") return detail;
  const fixAction = { type: "agent-integration", agentId: descriptor.agentId };
  if (
    descriptor.agentId === "codex"
    && detail.supplementary
    && detail.supplementary.key === "hooks"
    && detail.supplementary.value === "disabled"
  ) {
    fixAction.forceCodexHooksFeature = true;
  }
  return {
    ...detail,
    fixAction,
  };
}

function makeDetail(descriptor, status, fields = {}) {
  return {
    agentId: descriptor.agentId,
    agentName: descriptor.agentName,
    eventSource: descriptor.eventSource,
    status,
    ...fields,
  };
}

function statusLevel(status) {
  if (
    status === "not-connected"
    || status === "broken-path"
    || status === "config-corrupt"
    || status === "needs-review"
  ) {
    return "warning";
  }
  return status === "ok" ? null : "info";
}

// codex resolves commandWindows on Windows and command on POSIX
// (openai/codex#22159). Since #544, a win32-authored hooks.json carries a
// WSL-interop form in `command` that is only executable inside WSL, so the
// doctor must validate the field THIS platform's codex would run — the
// generic findHookCommands (command only) would flag every dual-field
// Windows install as broken-path, and Repair would regenerate the same
// fields forever.
function resolveCodexPlatformCommand(hook, platform) {
  if (!hook || typeof hook !== "object") return null;
  const windowsVariant = typeof hook.commandWindows === "string" ? hook.commandWindows : null;
  const base = typeof hook.command === "string" ? hook.command : null;
  return platform === "win32" ? (windowsVariant || base) : base;
}

function findCodexPlatformHookCommands(settings, marker, platform) {
  if (!settings || !settings.hooks || typeof settings.hooks !== "object") return [];
  const commands = [];
  const push = (hook) => {
    const resolved = resolveCodexPlatformCommand(hook, platform);
    if (resolved && commandMatchesMarker(resolved, marker)) commands.push(resolved);
  };
  for (const entries of Object.values(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (Array.isArray(entry.hooks)) {
        for (const hook of entry.hooks) push(hook);
      }
      push(entry);
    }
  }
  return commands;
}

function validateCodexCommandList(descriptor, commands, options) {
  if (!commands.length) return validateCommandList(descriptor, commands, options);
  const results = commands.map((command) => {
    const stable = inspectStableCodexHookCommand(command, {
      platform: options.platform,
      fs: options.fs,
      codexDir: descriptor.parentDir,
    });
    if (!stable.matched) {
      return options.validateCommand(command, { platform: options.platform, fs: options.fs });
    }
    if (!stable.ok) {
      return {
        ok: false,
        issue: stable.issue,
        scriptPath: stable.launcherPath || null,
      };
    }
    const result = options.validateTarget({
      nodeBin: stable.nodeBin,
      scriptPath: stable.scriptPath,
    }, {
      platform: options.platform,
      fs: options.fs,
      requireNodeExecutable: true,
    });
    return { ...result, stableExecution: result.ok === true };
  });
  const ok = results.find((result) => result.ok);
  if (ok) {
    return makeDetail(descriptor, "ok", {
      level: null,
      detail: ok.stableExecution
        ? `${descriptor.configPath} hook registered, stable execution target verified`
        : `${descriptor.configPath} hook registered, scriptPath verified`,
      commandCount: commands.length,
      scriptPath: ok.scriptPath,
    });
  }
  const first = results[0] || { issue: "parse-failed" };
  return makeDetail(descriptor, "broken-path", {
    level: "warning",
    detail: `hook command failed validation: ${first.issue}`,
    hookCommandIssue: first.issue || "parse-failed",
    nodeBin: first.nodeBin || null,
    scriptPath: first.scriptPath || null,
    commandFragment: String(commands[0] || "").slice(0, 128),
  });
}

function validateCommandList(descriptor, commands, options) {
  if (!commands.length) {
    return makeDetail(descriptor, "not-connected", {
      level: "warning",
      detail: `${descriptor.configPath} has no ${descriptor.marker} command`,
    });
  }

  const results = commands.map((command) => options.validateCommand(command, {
    platform: options.platform,
    fs: options.fs,
  }));
  const ok = results.find((result) => result.ok);
  if (ok) {
    return makeDetail(descriptor, "ok", {
      level: null,
      detail: `${descriptor.configPath} hook registered, scriptPath verified`,
      commandCount: commands.length,
      scriptPath: ok.scriptPath,
    });
  }

  const first = results[0] || { issue: "parse-failed" };
  return makeDetail(descriptor, "broken-path", {
    level: "warning",
    detail: `hook command failed validation: ${first.issue}`,
    hookCommandIssue: first.issue || "parse-failed",
    nodeBin: first.nodeBin || null,
    scriptPath: first.scriptPath || null,
    commandFragment: first.fragment || String(commands[0] || "").slice(0, 128),
  });
}

function findHookCommandsForEvent(settings, eventName, marker, options) {
  if (!settings || !settings.hooks || typeof marker !== "string" || !marker) return [];
  // Most agents keep per-event arrays directly under settings.hooks.<Event>
  // (the Claude Code settings.json schema). descriptor.hookEventsContainer
  // selects the container path (defaults to ["hooks"]).
  const containerPath = (options && Array.isArray(options.hookEventsContainer) && options.hookEventsContainer.length)
    ? options.hookEventsContainer
    : ["hooks"];
  let container = settings;
  for (const key of containerPath) {
    if (!container || typeof container !== "object") return [];
    container = container[key];
  }
  const entries = container ? container[eventName] : null;
  if (!Array.isArray(entries)) return [];

  const nested = options && options.nested;
  const commands = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (nested && Array.isArray(entry.hooks)) {
      for (const hook of entry.hooks) {
        if (hook && typeof hook.command === "string" && commandContainsFragment(hook.command, marker)) {
          commands.push(hook.command);
        }
      }
    }
    if (typeof entry.command === "string" && commandContainsFragment(entry.command, marker)) {
      commands.push(entry.command);
    }
  }
  return commands;
}

function validateFileHookEvents(descriptor, settings, options) {
  const events = descriptor.hookEvents;
  const agentName = descriptor.agentName || descriptor.agentId;
  const missingKey = "missingHookEvents";
  const brokenKey = "brokenHookEvent";
  const missingEvents = [];
  let commandCount = 0;
  let firstOk = null;
  let firstFailure = null;

  for (const eventName of events) {
    const commands = findHookCommandsForEvent(settings, eventName, descriptor.marker, {
      nested: !!descriptor.nested,
      hookEventsContainer: descriptor.hookEventsContainer,
    });
    commandCount += commands.length;
    if (!commands.length) {
      missingEvents.push(eventName);
      continue;
    }

    const results = commands.map((command) => options.validateCommand(command, {
      platform: options.platform,
      fs: options.fs,
    }));
    const ok = results.find((result) => result.ok);
    if (ok) {
      if (!firstOk) firstOk = ok;
      continue;
    }
    if (!firstFailure) {
      firstFailure = {
        eventName,
        result: results[0] || { issue: "parse-failed" },
        command: commands[0],
      };
    }
  }

  if (missingEvents.length) {
    return makeDetail(descriptor, "not-connected", {
      level: "warning",
      detail: `${descriptor.configPath} missing ${agentName} hook event(s): ${missingEvents.join(", ")}`,
      commandCount,
      [missingKey]: missingEvents,
    });
  }

  if (firstFailure) {
    const first = firstFailure.result;
    return makeDetail(descriptor, "broken-path", {
      level: "warning",
      detail: `${agentName} hook command failed validation for ${firstFailure.eventName}: ${first.issue || "parse-failed"}`,
      commandCount,
      hookCommandIssue: first.issue || "parse-failed",
      nodeBin: first.nodeBin || null,
      scriptPath: first.scriptPath || null,
      commandFragment: first.fragment || String(firstFailure.command || "").slice(0, 128),
      [brokenKey]: firstFailure.eventName,
    });
  }

  return makeDetail(descriptor, "ok", {
    level: null,
    detail: `${descriptor.configPath} ${agentName} hooks registered for ${events.length} events, scriptPath verified`,
    commandCount,
    scriptPath: firstOk && firstOk.scriptPath ? firstOk.scriptPath : null,
  });
}

function applyCodexSupplementary(detail, descriptor, options, settings) {
  if (!descriptor.supplementary || descriptor.supplementary.key !== "hooks") return detail;

  const supplementary = checkCodexHooksFeature(descriptor.supplementary.configPath, { fs: options.fs });
  if (
    supplementary.value === "disabled"
    && (detail.status === "ok" || REPAIRABLE_AGENT_STATUSES.has(detail.status))
  ) {
    return {
      ...detail,
      status: "not-connected",
      level: "warning",
      supplementary: {
        key: "hooks",
        value: supplementary.value,
        detail: supplementary.detail,
      },
      detail: "Codex hooks feature is disabled",
    };
  }
  if (detail.status !== "ok") return detail;
  const codexHookTrust = checkCodexHookTrust(
    descriptor.supplementary.configPath,
    settings,
    descriptor.configPath,
    {
      fs: options.fs,
      marker: descriptor.marker,
      platform: options.platform,
    }
  );
  const next = {
    ...detail,
    supplementary: {
      key: "hooks",
      value: supplementary.value,
      detail: supplementary.detail,
    },
    codexHookTrust,
  };
  if (codexHookTrust.value === "needs-review") {
    return {
      ...next,
      status: "needs-review",
      level: "warning",
      detail: "Codex hooks are installed but need review in Codex /hooks before they can run",
    };
  }
  return next;
}

// MiMo-style merged config (descriptor.configCandidates, highest-priority
// first): EVERY existing candidate loads, each parsed as JSONC exactly like
// the host's own loader, and the "plugin" array is REPLACED by the
// highest-priority file that declares it. The doctor must validate that
// EFFECTIVE view — checking one fixed file would bless a masked entry or
// miss the live one (#607 review). Only opencode-family JSONC members set
// configCandidates, so this always funnels into checkOpencodeSettings.
function checkMergedJsoncConfig(descriptor, options) {
  const existing = [];
  for (const candidate of descriptor.configCandidates) {
    if (!fileExists(options.fs, candidate)) continue;
    let tree;
    try {
      tree = readJsonc(options.fs, candidate);
    } catch (err) {
      return makeDetail(descriptor, "config-corrupt", {
        level: "warning",
        parentDirExists: true,
        configFileExists: true,
        configPath: candidate,
        detail: `${candidate}: ${err && err.message ? err.message : "config parse failed"}`,
      });
    }
    existing.push({ candidate, tree });
  }

  if (!existing.length) {
    return makeDetail(descriptor, descriptor.autoInstall ? "not-connected" : "manual-only", {
      level: descriptor.autoInstall ? "warning" : "info",
      parentDirExists: true,
      configFileExists: false,
      configPath: descriptor.configPath,
      detail: `${descriptor.configPath} missing`,
    });
  }

  const owner = existing.find((entry) => (
    entry.tree && typeof entry.tree === "object" && !Array.isArray(entry.tree)
    && Object.prototype.hasOwnProperty.call(entry.tree, "plugin")
  ));
  const effective = owner || existing[0];
  // Point every downstream message at the file whose plugin array is live.
  return checkOpencodeSettings({ ...descriptor, configPath: effective.candidate }, effective.tree, options);
}

function checkFileMode(descriptor, options) {
  if (Array.isArray(descriptor.configCandidates) && descriptor.configCandidates.length) {
    return checkMergedJsoncConfig(descriptor, options);
  }
  if (!fileExists(options.fs, descriptor.configPath)) {
    return makeDetail(descriptor, descriptor.autoInstall ? "not-connected" : "manual-only", {
      level: descriptor.autoInstall ? "warning" : "info",
      parentDirExists: true,
      configFileExists: false,
      configPath: descriptor.configPath,
      detail: `${descriptor.configPath} missing`,
    });
  }

  let settings;
  try {
    settings = descriptor.configJsonc
      ? readJsonc(options.fs, descriptor.configPath)
      : readJson(options.fs, descriptor.configPath);
  } catch (err) {
    return makeDetail(descriptor, "config-corrupt", {
      level: "warning",
      parentDirExists: true,
      configFileExists: true,
      configPath: descriptor.configPath,
      detail: err && err.message ? err.message : "config parse failed",
    });
  }

  if (descriptor.detection === "opencode-plugin") {
    return checkOpencodeSettings(descriptor, settings, options);
  }

  let detail;
  if (Array.isArray(descriptor.hookEvents) && descriptor.hookEvents.length) {
    detail = validateFileHookEvents(descriptor, settings, options);
  } else if (descriptor.agentId === "codex") {
    detail = validateCodexCommandList(
      descriptor,
      findCodexPlatformHookCommands(settings, descriptor.marker, options.platform || process.platform),
      options
    );
  } else {
    detail = validateCommandList(
      descriptor,
      findHookCommands(settings, descriptor.marker, { nested: !!descriptor.nested }),
      options
    );
  }
  detail = {
    ...detail,
    parentDirExists: true,
    configFileExists: true,
    configPath: descriptor.configPath,
  };
  return applyCodexSupplementary(detail, descriptor, options, settings);
}

function findOpencodePluginEntry(pluginEntries, marker) {
  if (!Array.isArray(pluginEntries)) return null;
  for (const entry of pluginEntries) {
    if (typeof entry !== "string") continue;
    const normalized = entry.replace(/\\/g, "/");
    const isAbsolute = path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized);
    if (isAbsolute && path.posix.basename(normalized) === marker) return entry;
  }
  return null;
}

function describeOpencodeEntryIssue(reason) {
  switch (reason) {
    case "not-absolute":
      return "the plugin path is not absolute";
    case "directory-missing":
      return "the plugin directory does not exist";
    case "not-a-directory":
      return "the plugin entry is not a directory";
    case "index-mjs-missing":
      return "the plugin directory has no index.mjs";
    case "index-mjs-unreadable":
      return "the plugin index.mjs could not be read";
    case "extra-module-exports":
      return "the module exports more than the default function, so opencode rejects it and loads nothing (#413)";
    case "family-core-missing":
      return "a shared opencode-family file the entry imports is missing (packaging problem)";
    default:
      return reason;
  }
}

function checkOpencodeSettings(descriptor, settings, options) {
  const entry = findOpencodePluginEntry(settings && settings.plugin, descriptor.marker);
  if (!entry) {
    return makeDetail(descriptor, "not-connected", {
      level: "warning",
      parentDirExists: true,
      configFileExists: true,
      configPath: descriptor.configPath,
      detail: `${descriptor.configPath} has no ${descriptor.marker} plugin entry`,
    });
  }

  const validation = validateOpencodeEntry(entry, { fs: options.fs });
  if (!validation.ok) {
    // family-core-missing carries WHICH shared file is gone — surface it, or
    // the user sees "packaging problem" with no way to tell core.mjs from
    // session-ids.mjs (the modal renders detail verbatim, no i18n layer).
    const missingSuffix = validation.missing ? ` — missing ${validation.missing}` : "";
    return makeDetail(descriptor, "broken-path", {
      level: "warning",
      parentDirExists: true,
      configFileExists: true,
      configPath: descriptor.configPath,
      detail: `opencode plugin entry is invalid: ${describeOpencodeEntryIssue(validation.reason)}${missingSuffix}`,
      opencodeEntryIssue: validation.reason,
      opencodeEntry: entry,
    });
  }

  return makeDetail(descriptor, "ok", {
    level: null,
    parentDirExists: true,
    configFileExists: true,
    configPath: descriptor.configPath,
    detail: `${descriptor.configPath} plugin entry verified`,
    opencodeEntry: entry,
  });
}

function readJsonIfPresent(fsImpl, filePath) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isPiManagedMarker(value) {
  return !!(
    value
    && value.app === "clawd-on-desk"
    && value.integration === "pi"
    && value.managed === true
  );
}

function checkPiExtensionMode(descriptor, options) {
  const extensionDir = descriptor.configPath;
  const markerPath = path.join(extensionDir, descriptor.markerFile || ".clawd-managed.json");
  const extensionPath = path.join(extensionDir, descriptor.marker || "index.ts");
  const corePath = path.join(extensionDir, descriptor.coreFile || "pi-extension-core.js");

  if (!dirExists(options.fs, extensionDir)) {
    return makeDetail(descriptor, "not-connected", {
      level: "warning",
      parentDirExists: true,
      configFileExists: false,
      configPath: extensionDir,
      extensionDir,
      detail: `${extensionDir} missing`,
    });
  }

  const marker = readJsonIfPresent(options.fs, markerPath);
  if (!isPiManagedMarker(marker)) {
    return makeDetail(descriptor, "needs-review", {
      level: "warning",
      parentDirExists: true,
      configFileExists: true,
      configPath: extensionDir,
      extensionDir,
      markerPath,
      detail: `${extensionDir} exists but is not Clawd-managed`,
    });
  }

  const extensionFileExists = fileExists(options.fs, extensionPath);
  const coreFileExists = fileExists(options.fs, corePath);
  if (!extensionFileExists || !coreFileExists) {
    return makeDetail(descriptor, "broken-path", {
      level: "warning",
      parentDirExists: true,
      configFileExists: true,
      configPath: extensionDir,
      extensionDir,
      markerPath,
      extensionPath,
      corePath,
      extensionFileExists,
      coreFileExists,
      detail: "Pi extension files are missing or incomplete",
    });
  }

  return makeDetail(descriptor, "ok", {
    level: null,
    parentDirExists: true,
    configFileExists: true,
    configPath: extensionDir,
    extensionDir,
    markerPath,
    extensionPath,
    corePath,
    extensionFileExists,
    coreFileExists,
    detail: `${extensionDir} extension verified`,
  });
}

function checkAgent(descriptor, options) {
  const prefs = options.prefs || {};
  if (!isAgentIntegrationInstalled(prefs, descriptor.agentId)) {
    return makeDetail(descriptor, "not-managed", {
      level: "info",
      detail: "This integration is not installed in Settings",
    });
  }

  if (!isAgentEnabled(prefs, descriptor.agentId)) {
    return makeDetail(descriptor, "disabled", {
      level: "info",
      detail: "You disabled this agent in Settings",
    });
  }

  if (descriptor.agentId === "claude-code" && prefs.manageClaudeHooksAutomatically === false) {
    return makeDetail(descriptor, "manual-managed", {
      level: "info",
      detail: "Automatic Claude hook management is disabled",
    });
  }

  if (descriptor.configMode === "none-global") {
    return makeDetail(descriptor, "manual-only", {
      level: "info",
      detail: "This agent does not use a host-managed config file",
      scriptPath: descriptor.scriptPath || null,
      scriptExists: descriptor.scriptPath ? fileExists(options.fs, descriptor.scriptPath) : null,
    });
  }

  // Multi-home agents declare ordered configTargets, using the first
  // existing directory unless preferExistingConfigFile asks for an existing
  // settings file first.
  const configTargets = Array.isArray(descriptor.configTargets) ? descriptor.configTargets : [];
  const activeTarget = descriptor.preferExistingConfigFile
    ? configTargets.find((target) => fileExists(options.fs, target.configPath))
      || configTargets.find((target) => dirExists(options.fs, target.parentDir))
    : configTargets.find((target) => dirExists(options.fs, target.parentDir));
  const effectiveDescriptor = activeTarget
    ? { ...descriptor, parentDir: activeTarget.parentDir, configPath: activeTarget.configPath }
    : descriptor;

  const parentDirExists = effectiveDescriptor.parentDir
    ? dirExists(options.fs, effectiveDescriptor.parentDir)
    : false;
  if (!parentDirExists) {
    return makeDetail(descriptor, "not-installed", {
      level: "info",
      parentDirExists: false,
      configPath: descriptor.configPath,
      detail: Array.isArray(descriptor.configTargets)
        ? `${descriptor.configTargets.map((target) => target.parentDir).join(" / ")} missing`
        : `${descriptor.parentDir} missing`,
    });
  }
  descriptor = effectiveDescriptor;

  let detail;
  if (descriptor.configMode === "file") {
    detail = checkFileMode(descriptor, options);
  } else if (descriptor.configMode === "pi-extension") {
    detail = checkPiExtensionMode(descriptor, options);
  } else {
    detail = makeDetail(descriptor, "manual-only", {
      level: "info",
      detail: `Unsupported config mode: ${descriptor.configMode}`,
    });
  }

  detail = withClaudeHookGuardNotice(detail, descriptor, options);
  return withAgentFixAction(withAgentBubbleNote(detail, prefs, descriptor.agentId), descriptor);
}

function summarize(details) {
  const counts = {};
  for (const detail of details) {
    counts[detail.status] = (counts[detail.status] || 0) + 1;
  }
  const warningCount = details.filter((detail) => statusLevel(detail.status) === "warning").length;
  const okCount = counts.ok || 0;
  let status = "pass";
  let level = null;
  if (warningCount > 0) {
    status = "warning";
    level = "warning";
  }
  // An all-info aggregate (every integration disabled / manual-managed / not
  // installed) is a deliberate user or environment choice, not a fault, so the
  // summary stays green (#490). The "nothing is wired up" hint is surfaced as
  // info-level UI copy instead, and a genuinely broken local server is still
  // flagged red by the separate local-server check.
  return { status, level, counts, okCount, warningCount };
}

function checkAgentIntegrations(options = {}) {
  const detectorOptions = {
    fs: options.fs || fs,
    platform: options.platform || process.platform,
    env: options.env || process.env,
    prefs: options.prefs || {},
    server: options.server || null,
    validateCommand: options.validateCommand || validateHookCommand,
    validateTarget: options.validateTarget || validateHookTarget,
    homeDir: options.homeDir,
  };
  const descriptors = options.descriptors || getAgentDescriptors();
  const details = descriptors.map((descriptor) => checkAgent(descriptor, detectorOptions));
  const summary = summarize(details);
  return {
    id: "agent-integrations",
    ...summary,
    details,
  };
}

module.exports = {
  checkAgentIntegrations,
  checkAgent,
  findOpencodePluginEntry,
  summarize,
  __test: {
    checkFileMode,
    checkPiExtensionMode,
    validateCommandList,
  },
};
