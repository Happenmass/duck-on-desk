"use strict";

function hasPositiveCount(value) {
  return Number.isFinite(value) && value > 0;
}

function asOk(result, fallback = {}) {
  if (result && typeof result === "object") {
    if (typeof result.status === "string") return result;
    return { status: "ok", ...result };
  }
  return { status: "ok", ...fallback };
}

function asSkipped(result, reason, message) {
  const base = result && typeof result === "object" ? result : {};
  return {
    status: "skipped",
    ...base,
    reason: (base.reason || reason),
    message: (base.message || message),
  };
}

function normalizeCountSyncResult(result, agentName, reason) {
  if (!result || typeof result !== "object") return { status: "ok" };
  if (typeof result.status === "string") return result;
  const changed =
    hasPositiveCount(result.added)
    || hasPositiveCount(result.updated)
    || hasPositiveCount(result.removed)
    || result.changed === true
    || result.created === true
    || result.configChanged === true;
  const alreadyCurrent = hasPositiveCount(result.skipped);
  if (!changed && !alreadyCurrent) {
    return asSkipped(result, reason, `${agentName} is not installed; skipped integration sync`);
  }
  return asOk(result);
}

function normalizeInstalledFlagResult(result, agentName, reason) {
  if (!result || typeof result !== "object") return { status: "ok" };
  if (typeof result.status === "string") return result;
  if (result.installed === false) {
    const skipReason = result.reason || reason;
    return asSkipped(result, skipReason, result.message || defaultInstalledFlagSkipMessage(agentName, skipReason));
  }
  return asOk(result);
}

function isNotInstalledReason(reason) {
  return reason === "not-found"
    || reason === "not-installed"
    || (typeof reason === "string" && (
      reason.endsWith("-not-found")
      || reason.endsWith("-not-installed")
    ));
}

function defaultInstalledFlagSkipMessage(agentName, reason) {
  if (isNotInstalledReason(reason)) {
    return `${agentName} is not installed; skipped integration sync`;
  }
  return reason
    ? `${agentName} integration sync skipped: ${reason}`
    : `${agentName} integration sync skipped`;
}

function createIntegrationSyncRuntime(options = {}) {
  const ctx = options.ctx || {};
  const getHookServerPort = options.getHookServerPort;
  const shouldManageClaudeHooks = options.shouldManageClaudeHooks;
  const isAgentEnabled = typeof options.isAgentEnabled === "function" ? options.isAgentEnabled : (() => true);
  const shouldSyncAgentIntegration = typeof options.shouldSyncAgentIntegration === "function"
    ? options.shouldSyncAgentIntegration
    : isAgentEnabled;
  const getAgentIntegrationOptions = typeof options.getAgentIntegrationOptions === "function"
    ? options.getAgentIntegrationOptions
    : (() => ({}));
  const startClaudeSettingsWatcher = options.startClaudeSettingsWatcher;
  const stopClaudeSettingsWatcher = options.stopClaudeSettingsWatcher;

  function readAgentIntegrationOptions(agentId) {
    try {
      const result = getAgentIntegrationOptions(agentId);
      return result && typeof result === "object" ? result : {};
    } catch (err) {
      console.warn(`Clawd: failed to read ${agentId} integration options:`, err && err.message);
      return {};
    }
  }

  function syncClawdHooks(options = {}) {
    const source = typeof options.source === "string" ? options.source : null;
    const automatic = options.automatic !== false;
    try {
      if (typeof ctx.syncClawdHooksImpl === "function") {
        return ctx.syncClawdHooksImpl({
          autoStart: ctx.autoStartWithClaude,
          port: getHookServerPort(),
          source,
          automatic,
        });
      }
      const {
        registerHooks,
        registerClaudeStatusline,
        unregisterClaudeStatusline,
      } = require("../hooks/install.js");
      const { added, updated, removed } = registerHooks({
        silent: true,
        autoStart: ctx.autoStartWithClaude,
        port: getHookServerPort(),
      });
      if (added > 0 || updated > 0 || removed > 0) {
        console.log(`Clawd: synced hooks (added ${added}, updated ${updated}, removed ${removed})`);
      }
      // Statusline registration is best-effort and reported separately: it only
      // takes the slot when empty/already ours (never overwrites a user's own
      // statusline), so a skip here is expected and must not affect the
      // hooks-sync status returned below.
      try {
        if (ctx.claudeQuotaCollectionEnabled === true) {
          const statuslineResult = registerClaudeStatusline({ silent: true });
          if (statuslineResult.changed) {
            console.log("Clawd: registered Claude Code statusline (rate limit quota)");
          }
        } else {
          unregisterClaudeStatusline({ backup: true, silent: true });
        }
      } catch (statuslineErr) {
        console.warn("Clawd: failed to sync Claude Code statusline:", statuslineErr.message);
      }
      return { status: "ok", added, updated, removed };
    } catch (err) {
      console.warn("Clawd: failed to sync hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Claude hooks" };
    }
  }

  function syncCodexHooks() {
    try {
      if (typeof ctx.syncCodexHooksImpl === "function") return ctx.syncCodexHooksImpl();
      const { registerCodexHooks } = require("../hooks/codex-install.js");
      const result = registerCodexHooks({ silent: true });
      if (hasPositiveCount(result.added) || hasPositiveCount(result.updated)) {
        console.log(`Clawd: synced Codex hooks (added ${result.added}, updated ${result.updated})`);
      }
      if (Array.isArray(result.warnings)) {
        for (const warning of result.warnings) console.warn(`Clawd: Codex hook sync warning: ${warning}`);
      }
      return normalizeCountSyncResult(result, "Codex CLI", "codex-not-installed");
    } catch (err) {
      console.warn("Clawd: failed to sync Codex hooks:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Codex hooks" };
    }
  }

  function repairCodexHooks(options = {}) {
    try {
      if (typeof ctx.repairCodexHooksImpl === "function") return ctx.repairCodexHooksImpl(options);
      const { registerCodexHooks } = require("../hooks/codex-install.js");
      const { added, updated, configChanged, warnings } = registerCodexHooks({
        silent: true,
        forceCodexHooksFeature: options && options.forceCodexHooksFeature === true,
      });
      if (added > 0 || updated > 0 || configChanged) {
        console.log(`Clawd: repaired Codex hooks (added ${added}, updated ${updated}, configChanged=${!!configChanged})`);
      }
      if (Array.isArray(warnings)) {
        for (const warning of warnings) console.warn(`Clawd: Codex hook repair warning: ${warning}`);
        if (warnings.length > 0) {
          return {
            status: "error",
            message: `Codex hooks were repaired, but ${warnings.join("; ")}`,
          };
        }
      }
      return {
        status: "ok",
        added,
        updated,
        configChanged,
        message: configChanged
          ? "Codex hooks repaired and [features].hooks updated"
          : "Codex hooks repaired",
      };
    } catch (err) {
      console.warn("Clawd: failed to repair Codex hooks:", err.message);
      return { status: "error", message: err && err.message };
    }
  }

  function syncOpencodePlugin() {
    try {
      if (typeof ctx.syncOpencodePluginImpl === "function") return ctx.syncOpencodePluginImpl();
      const { registerOpencodePlugin } = require("../hooks/opencode-install.js");
      const result = registerOpencodePlugin({ silent: true });
      if (result.added || result.created) {
        console.log(`Clawd: synced opencode plugin (added=${result.added}, created=${result.created})`);
      }
      if (result && result.reason === "opencode-not-found") {
        return asSkipped(result, "opencode-not-found", "opencode is not installed; skipped plugin sync");
      }
      return asOk(result);
    } catch (err) {
      console.warn("Clawd: failed to sync opencode plugin:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync opencode plugin" };
    }
  }

  function syncPiExtension() {
    try {
      if (typeof ctx.syncPiExtensionImpl === "function") return ctx.syncPiExtensionImpl();
      const { registerPiExtension } = require("../hooks/pi-install.js");
      const result = registerPiExtension({ silent: true });
      if (result.installed && result.updated) {
        console.log("Clawd: synced Pi extension");
      }
      return normalizeInstalledFlagResult(result, "Pi", "pi-not-found");
    } catch (err) {
      console.warn("Clawd: failed to sync Pi extension:", err.message);
      return { status: "error", message: err && err.message ? err.message : "Failed to sync Pi extension" };
    }
  }

  const AGENT_INTEGRATION_SYNCERS = Object.freeze({
    codex: syncCodexHooks,
    opencode: syncOpencodePlugin,
    pi: syncPiExtension,
  });

  const AGENT_INTEGRATION_REPAIRERS = Object.freeze({
    ...AGENT_INTEGRATION_SYNCERS,
    codex: repairCodexHooks,
  });

  function isClaudeSyncErrorResult(result) {
    return !!(result && typeof result === "object" && result.status === "error");
  }

  function syncIntegrationForAgent(agentId, options = {}) {
    if (agentId === "claude-code") {
      if (!shouldManageClaudeHooks()) return false;
      const result = syncClawdHooks(options);
      // Claude watcher baseline seeding reads settings.json, so it must not run
      // until this sync has actually settled — an in-flight (queued) async sync
      // must not be mistaken for a completed one. Synchronous/test-injected
      // seams (no .then) keep the prior immediate-start behavior.
      //
      // The watcher only starts when the sync actually succeeded: Settings
      // Agent Install/Enable call this path with the agent's installed/enabled
      // state still contingent on THIS result — starting the watcher on
      // failure would leave it running for an agent prefs still show as
      // disabled/uninstalled. (Doctor Fix's repairIntegrationForAgent()
      // below starts the watcher unconditionally instead, since by the time
      // it runs, enabled is already an established precondition independent
      // of this particular repair's outcome.)
      if (result && typeof result === "object" && typeof result.then === "function") {
        return result.then((resolved) => {
          if (!isClaudeSyncErrorResult(resolved)) startClaudeSettingsWatcher();
          return resolved;
        });
      }
      if (!isClaudeSyncErrorResult(result)) startClaudeSettingsWatcher();
      return result && typeof result === "object" ? result : true;
    }
    const sync = AGENT_INTEGRATION_SYNCERS[agentId];
    if (typeof sync !== "function") return false;
    const result = sync(options);
    return result && typeof result === "object" ? result : true;
  }

  function repairIntegrationForAgent(agentId, options = {}) {
    if (agentId === "claude-code") {
      // Doctor Fix only runs once claude-code is already confirmed installed
      // and enabled (checked by the caller before invoking repair) — that
      // state does not depend on this repair's outcome, so the watcher
      // belongs running regardless of whether this specific attempt verifies
      // healthy. start() is idempotent, so this is a no-op if it's already up.
      const result = syncIntegrationForAgent(agentId, { source: "doctor", automatic: false });
      if (result && typeof result === "object" && typeof result.then === "function") {
        return result.then((resolved) => {
          startClaudeSettingsWatcher();
          return resolved;
        });
      }
      startClaudeSettingsWatcher();
      return result;
    }
    const repair = AGENT_INTEGRATION_REPAIRERS[agentId];
    if (typeof repair !== "function") return false;
    const result = repair(options);
    // Async installers are themselves structured results in flight; returning
    // the object lets Settings/Doctor await the real outcome instead of
    // committing success before the mutation has settled.
    return result && typeof result === "object" ? result : true;
  }

  function stopIntegrationForAgent(agentId) {
    if (agentId !== "claude-code") return false;
    return stopClaudeSettingsWatcher();
  }

  function uninstallIntegrationForAgent(agentId) {
    try {
      if (
        ctx.uninstallIntegrationImpls
        && typeof ctx.uninstallIntegrationImpls === "object"
        && typeof ctx.uninstallIntegrationImpls[agentId] === "function"
      ) {
        if (agentId === "claude-code") stopClaudeSettingsWatcher();
        return ctx.uninstallIntegrationImpls[agentId]({ silent: true });
      }
      const {
        AGENT_CLEANERS,
        buildCleanupOptionsForHome,
      } = require("../hooks/cleanup-integrations.js");
      const uninstall = AGENT_CLEANERS && AGENT_CLEANERS[agentId];
      if (typeof uninstall !== "function") return false;
      if (agentId === "claude-code") stopClaudeSettingsWatcher();
      const cleanupOptions = ctx.cleanupOptions && typeof ctx.cleanupOptions === "object"
        ? ctx.cleanupOptions
        : {};
      const plan = buildCleanupOptionsForHome(ctx.cleanupHomeDir || ctx.homeDir, cleanupOptions);
      const agentOptions = plan.byAgent && plan.byAgent[agentId];
      if (!agentOptions) return false;
      const result = uninstall({ ...agentOptions, silent: true });
      return result && typeof result === "object" ? result : true;
    } catch (err) {
      console.warn(`Clawd: failed to uninstall ${agentId} integration:`, err.message);
      return {
        status: "error",
        message: err && err.message ? err.message : `Failed to uninstall ${agentId} integration`,
      };
    }
  }

  function syncEnabledStartupIntegrations() {
    if (shouldManageClaudeHooks() && shouldSyncAgentIntegration("claude-code")) {
      const result = syncClawdHooks({ source: "startup", automatic: true });
      if (result && typeof result === "object" && typeof result.then === "function") {
        result.then(() => startClaudeSettingsWatcher());
      } else {
        startClaudeSettingsWatcher();
      }
    }
    // Other agents' syncs are independent files and run in parallel — they do
    // not wait for Claude's (possibly queued/async) sync to settle.
    for (const [agentId, sync] of Object.entries(AGENT_INTEGRATION_SYNCERS)) {
      if (shouldSyncAgentIntegration(agentId)) sync(readAgentIntegrationOptions(agentId));
    }
  }

  return {
    syncClawdHooks,
    syncCodexHooks,
    syncOpencodePlugin,
    syncPiExtension,
    repairCodexHooks,
    syncIntegrationForAgent,
    repairIntegrationForAgent,
    stopIntegrationForAgent,
    uninstallIntegrationForAgent,
    syncEnabledStartupIntegrations,
  };
}

module.exports = {
  createIntegrationSyncRuntime,
};
