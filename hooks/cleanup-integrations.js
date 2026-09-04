#!/usr/bin/env node
"use strict";

const os = require("os");
const path = require("path");

const { unregisterHooks: unregisterClaudeHooks, unregisterClaudeStatusline } = require("./install");
const {
  removeStableCodexHookLauncher,
  unregisterCodexCommandHooks,
} = require("./codex-install-utils");
const { unregisterOpencodePlugin } = require("./opencode-install");
const { unregisterPiExtension } = require("./pi-install");

const CODEX_MARKERS = ["codex-hook.js", "codex-debug-hook.js"];

const MANAGED_AGENT_IDS = Object.freeze([
  "claude-code",
  "codex",
  "opencode",
  "pi",
]);

const AGENT_DISPLAY_NAMES = Object.freeze({
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  opencode: "opencode",
  pi: "Pi",
});

function normalizeHomeDir(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : os.homedir();
  return path.resolve(raw);
}

function buildTargetEnv(homeDir, options = {}) {
  const env = { ...((options.env && typeof options.env === "object") ? options.env : process.env) };
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  if ((options.platform || process.platform) === "win32") {
    env.LOCALAPPDATA = options.localAppData || path.join(homeDir, "AppData", "Local");
    env.APPDATA = options.appData || path.join(homeDir, "AppData", "Roaming");
  }
  return env;
}

function buildCleanupOptionsForHome(homeDirInput, options = {}) {
  const explicitHomeDir = Boolean(homeDirInput || options.homeDir || options.userHome);
  const homeDir = normalizeHomeDir(homeDirInput || options.homeDir || options.userHome);
  const env = buildTargetEnv(homeDir, options);
  const backup = options.backup !== false;
  const silent = options.silent !== false;
  const common = { backup, silent };
  const explicitCodexHome = typeof options.codexDir === "string" && options.codexDir.trim()
    ? options.codexDir.trim()
    : (typeof options.codexHome === "string" && options.codexHome.trim()
      ? options.codexHome.trim()
      : (options.env && typeof options.env.CODEX_HOME === "string" && options.env.CODEX_HOME.trim()
        ? options.env.CODEX_HOME.trim()
        : null));
  const inheritedCodexHome = !explicitHomeDir
    && typeof env.CODEX_HOME === "string"
    && env.CODEX_HOME.trim()
    ? env.CODEX_HOME.trim()
    : null;
  const codexDir = explicitCodexHome || inheritedCodexHome || path.join(homeDir, ".codex");

  return {
    homeDir,
    env,
    common,
    byAgent: {
      "claude-code": {
        ...common,
        settingsPath: path.join(homeDir, ".claude", "settings.json"),
      },
      codex: {
        ...common,
        homeDir,
        codexDir,
        hooksPath: path.join(codexDir, "hooks.json"),
        markers: CODEX_MARKERS,
      },
      opencode: {
        ...common,
        configPath: path.join(homeDir, ".config", "opencode", "opencode.json"),
      },
      pi: {
        ...common,
        parentDir: path.join(homeDir, ".pi", "agent"),
      },
    },
  };
}

function unregisterClaudeIntegration(options = {}) {
  const hooks = unregisterClaudeHooks(options);
  const statusline = unregisterClaudeStatusline(options);
  return {
    removed: removedCountFromResult(hooks) + removedCountFromResult(statusline),
    changed: changedFromResult(hooks) || changedFromResult(statusline),
    backupPaths: [...backupPathsFromResult(hooks), ...backupPathsFromResult(statusline)],
    hooks,
    statusline,
  };
}

function unregisterCodexIntegration(options = {}) {
  const hooks = unregisterCodexCommandHooks(options);
  const stableLauncher = removeStableCodexHookLauncher(options);
  return {
    ...hooks,
    changed: changedFromResult(hooks) || stableLauncher.changed,
    stableLauncher,
  };
}

const AGENT_CLEANERS = Object.freeze({
  "claude-code": unregisterClaudeIntegration,
  codex: unregisterCodexIntegration,
  opencode: unregisterOpencodePlugin,
  pi: unregisterPiExtension,
});

function removedCountFromResult(result) {
  if (!result || typeof result !== "object") return 0;
  if (typeof result.removed === "number") return result.removed;
  if (result.removed === true) return 1;
  return 0;
}

function changedFromResult(result) {
  if (!result || typeof result !== "object") return false;
  if (result.changed === true || result.updated === true || result.removed === true) return true;
  return removedCountFromResult(result) > 0;
}

function backupPathsFromResult(result) {
  if (!result || typeof result !== "object") return [];
  const paths = [];
  if (typeof result.backupPath === "string" && result.backupPath) paths.push(result.backupPath);
  if (Array.isArray(result.backupPaths)) {
    for (const backupPath of result.backupPaths) {
      if (typeof backupPath === "string" && backupPath) paths.push(backupPath);
    }
  }
  return paths;
}

function warningsFromResult(agentId, result) {
  const warnings = [];
  if (result && Array.isArray(result.warnings)) warnings.push(...result.warnings);
  return warnings;
}

function notesFromResult(agentId, result) {
  return [];
}

async function cleanupIntegrations(options = {}) {
  const plan = buildCleanupOptionsForHome(options.homeDir || options.userHome, options);
  const agents = [];
  let entriesRemoved = 0;
  let agentsAffected = 0;
  let skipped = 0;
  let failed = 0;

  for (const agentId of MANAGED_AGENT_IDS) {
    const clean = AGENT_CLEANERS[agentId];
    const cleanOptions = plan.byAgent && plan.byAgent[agentId];
    const agent = {
      agentId,
      displayName: AGENT_DISPLAY_NAMES[agentId] || agentId,
      status: "pending",
      removed: 0,
      changed: false,
      backupPaths: [],
      warnings: [],
      notes: [],
      error: null,
      result: null,
    };

    try {
      // Claude hooks + statusline may already have been unregistered through
      // the server-owned operation queue (see main.js's cleanupIntegrations
      // wrapper for #657) before this function runs. When that precomputed
      // result is provided, record it instead of unregistering Claude a
      // second time here, outside the queue.
      if (agentId === "claude-code" && Object.prototype.hasOwnProperty.call(options, "claudeCleanupResult")) {
        const result = options.claudeCleanupResult;
        if (result && result.status === "error") {
          agent.status = "failed";
          agent.error = result.message || "Claude hook queue cleanup failed";
          failed++;
        } else {
          const removed = removedCountFromResult(result);
          const changed = changedFromResult(result);
          agent.removed = removed;
          agent.changed = changed;
          agent.backupPaths = backupPathsFromResult(result);
          agent.result = result;
          if (changed || removed > 0) {
            agent.status = "applied";
            agentsAffected++;
          } else {
            agent.status = "skipped";
            skipped++;
          }
          entriesRemoved += removed;
        }
      } else if (!cleanOptions) {
        agent.status = "failed";
        agent.error = "Missing cleanup path overrides";
        failed++;
      } else if (typeof clean !== "function") {
        agent.status = "skipped";
        agent.error = "No cleaner registered";
        skipped++;
      } else {
        const result = await clean(cleanOptions);
        const removed = removedCountFromResult(result);
        const changed = changedFromResult(result);
        agent.removed = removed;
        agent.changed = changed;
        agent.backupPaths = backupPathsFromResult(result);
        agent.warnings = warningsFromResult(agentId, result);
        agent.notes = notesFromResult(agentId, result);
        agent.result = result;
        if (result && result.status === "error") {
          agent.status = "failed";
          agent.error = result.message || `Failed to clean ${agent.displayName} integration`;
          failed++;
          if (changed || removed > 0) agentsAffected++;
        } else if (changed || removed > 0) {
          agent.status = "applied";
          agentsAffected++;
        } else {
          agent.status = "skipped";
          skipped++;
        }
        entriesRemoved += removed;
      }
    } catch (err) {
      agent.status = "failed";
      agent.error = err && err.message ? err.message : String(err);
      failed++;
    }
    agents.push(agent);
  }

  return {
    mode: "apply",
    homeDir: plan.homeDir,
    agents,
    summary: {
      agentsChecked: agents.length,
      agentsAffected,
      entriesRemoved,
      skipped,
      failed,
    },
  };
}

function parseArgs(argv) {
  const options = { backup: true, silent: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") continue;
    if (arg === "--no-backup") {
      options.backup = false;
      continue;
    }
    if (arg === "--silent") {
      options.silent = true;
      continue;
    }
    if (arg === "--fail-open") {
      options.failOpen = true;
      continue;
    }
    if (arg === "--source") {
      options.source = argv[++i];
      continue;
    }
    if (arg === "--user-home" || arg === "--home" || arg === "--home-dir") {
      options.homeDir = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printResult(result) {
  console.log(`Duck integration cleanup -> ${result.homeDir}`);
  for (const agent of result.agents) {
    const suffix = agent.error ? ` (${agent.error})` : "";
    console.log(`  ${agent.displayName}: ${agent.status}, removed=${agent.removed}${suffix}`);
    for (const warning of agent.warnings || []) {
      console.log(`    warning: ${warning}`);
    }
  }
  const summary = result.summary;
  console.log(
    `Summary: affected=${summary.agentsAffected}, removed=${summary.entriesRemoved}, skipped=${summary.skipped}, failed=${summary.failed}`
  );
}

if (require.main === module) {
  let options;
  Promise.resolve()
    .then(async () => {
      options = parseArgs(process.argv.slice(2));
      const result = await cleanupIntegrations(options);
      if (!options.silent) printResult(result);
      if (result.summary.failed > 0 && !options.failOpen) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : err);
      if (!options || !options.failOpen) process.exitCode = 1;
    });
}

module.exports = {
  AGENT_CLEANERS,
  AGENT_DISPLAY_NAMES,
  CODEX_MARKERS,
  MANAGED_AGENT_IDS,
  buildCleanupOptionsForHome,
  cleanupIntegrations,
  parseArgs,
};
