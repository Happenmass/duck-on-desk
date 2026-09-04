"use strict";

const { afterEach, beforeEach, describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createIntegrationSyncRuntime } = require("../src/integration-sync");

const missingFakeImpls = [];
let integrationFailureWarnings = [];
let allowedIntegrationFailureWarningPatterns = [];
let restoreConsoleWarn = null;

function createGuardedIntegrationCtx(target, calls) {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        return Reflect.get(obj, prop, receiver);
      }
      if (typeof prop !== "string" || !/^(sync|repair)[A-Z]\w*Impl$/.test(prop)) {
        return Reflect.get(obj, prop, receiver);
      }
      return () => {
        calls.push({ name: `missing-fake:${prop}` });
        missingFakeImpls.push(prop);
        throw new Error(`Missing integration test fake: ${prop}`);
      };
    },
  });
}

function withPatchedExport(modulePath, exportName, replacement, run) {
  const moduleExports = require(modulePath);
  const original = moduleExports[exportName];
  moduleExports[exportName] = replacement;
  try {
    return run();
  } finally {
    moduleExports[exportName] = original;
  }
}

function makeRuntime(overrides = {}) {
  const calls = [];
  const repairOptions = [];
  const { ctx: ctxOverrides = {}, ...runtimeOverrides } = overrides;
  const ctx = createGuardedIntegrationCtx({
    autoStartWithClaude: true,
    syncDuckHooksImpl: (options) => {
      calls.push({ name: "claude", options });
      return { status: "ok", source: "claude" };
    },
    syncCodexHooksImpl: () => calls.push({ name: "codex" }),
    repairCodexHooksImpl: (options) => {
      calls.push({ name: "codex-repair" });
      repairOptions.push(options);
      return { status: "ok", message: "done" };
    },
    syncOpencodePluginImpl: () => calls.push({ name: "opencode" }),
    syncPiExtensionImpl: () => calls.push({ name: "pi" }),
    ...ctxOverrides,
  }, calls);
  const runtime = createIntegrationSyncRuntime({
    getHookServerPort: () => 24444,
    shouldManageClaudeHooks: () => true,
    isAgentEnabled: () => true,
    startClaudeSettingsWatcher: () => calls.push({ name: "watcher:start" }),
    stopClaudeSettingsWatcher: () => {
      calls.push({ name: "watcher:stop" });
      return "stopped";
    },
    ...runtimeOverrides,
    ctx,
  });
  return { runtime, calls, repairOptions };
}

describe("integration sync runtime", () => {
  beforeEach(() => {
    const originalWarn = console.warn;
    integrationFailureWarnings = [];
    allowedIntegrationFailureWarningPatterns = [];
    restoreConsoleWarn = () => {
      console.warn = originalWarn;
    };
    console.warn = (...args) => {
      const message = args.map((arg) => String(arg)).join(" ");
      if (/^Duck:\s+failed to (?:sync|repair)\b/i.test(message)) {
        integrationFailureWarnings.push(message);
        return;
      }
      originalWarn(...args);
    };
  });

  afterEach(() => {
    if (restoreConsoleWarn) restoreConsoleWarn();
    restoreConsoleWarn = null;
    const missing = missingFakeImpls.splice(0);
    const warnings = integrationFailureWarnings;
    integrationFailureWarnings = [];
    const unexpectedWarnings = warnings.filter((message) => (
      !allowedIntegrationFailureWarningPatterns.some((pattern) => pattern.test(message))
    ));
    allowedIntegrationFailureWarningPatterns = [];
    assert.deepStrictEqual(
      { missingFakeImpls: missing, unexpectedIntegrationFailureWarnings: unexpectedWarnings },
      { missingFakeImpls: [], unexpectedIntegrationFailureWarnings: [] }
    );
  });

  it("test ctx guard records missing sync/repair fakes and blocks real fallbacks", () => {
    const calls = [];
    const ctx = createGuardedIntegrationCtx({}, calls);
    const runtime = createIntegrationSyncRuntime({ ctx });
    allowedIntegrationFailureWarningPatterns.push(
      /^Duck:\s+failed to sync Codex hooks:\s+Missing integration test fake: syncCodexHooksImpl$/
    );

    const result = runtime.syncCodexHooks();
    assert.throws(
      () => ctx.repairFuturePluginImpl(),
      /Missing integration test fake: repairFuturePluginImpl/
    );

    assert.deepStrictEqual(result, {
      status: "error",
      message: "Missing integration test fake: syncCodexHooksImpl",
    });
    assert.deepStrictEqual(calls, [
      { name: "missing-fake:syncCodexHooksImpl" },
      { name: "missing-fake:repairFuturePluginImpl" },
    ]);
    assert.deepStrictEqual(missingFakeImpls.splice(0), [
      "syncCodexHooksImpl",
      "repairFuturePluginImpl",
    ]);
  });

  it("syncDuckHooks passes auto-start, the current server port, and sync provenance", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.syncDuckHooks();

    assert.deepStrictEqual(result, { status: "ok", source: "claude" });
    assert.deepStrictEqual(calls, [
      { name: "claude", options: { autoStart: true, port: 24444, source: null, automatic: true } },
    ]);
  });

  it("syncDuckHooks forwards an explicit source/automatic pair unchanged", () => {
    const { runtime, calls } = makeRuntime();

    runtime.syncDuckHooks({ source: "doctor", automatic: false });

    assert.deepStrictEqual(calls, [
      { name: "claude", options: { autoStart: true, port: 24444, source: "doctor", automatic: false } },
    ]);
  });

  it("repairIntegrationForAgent('claude-code') syncs as an explicit, non-automatic doctor repair", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.repairIntegrationForAgent("claude-code");

    assert.deepStrictEqual(result, { status: "ok", source: "claude" });
    // watcher:start appears twice: once from syncIntegrationForAgent's own
    // success path, once from repairIntegrationForAgent's unconditional
    // ensure-started call (Doctor Fix's enabled precondition holds regardless
    // of this repair's outcome). start() is idempotent in production; the
    // fake watcher stub here just isn't, so both calls show up.
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["claude", "watcher:start", "watcher:start"]);
    assert.deepStrictEqual(calls[0].options, { autoStart: true, port: 24444, source: "doctor", automatic: false });
  });

  it("syncIntegrationForAgent waits for an async Claude sync to settle before starting the watcher", async () => {
    let resolveSync;
    const { runtime, calls } = makeRuntime({
      ctx: {
        syncDuckHooksImpl: (options) => {
          calls.push({ name: "claude", options });
          return new Promise((resolve) => { resolveSync = resolve; });
        },
      },
    });

    const pending = runtime.syncIntegrationForAgent("claude-code");
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["claude"], "watcher must not start before the async sync settles");

    resolveSync({ status: "ok" });
    const result = await pending;

    assert.deepStrictEqual(result, { status: "ok" });
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["claude", "watcher:start"]);
  });

  it("does not start the Claude watcher when a synchronous sync result is an error (Settings Enable failure)", () => {
    const { runtime, calls } = makeRuntime({
      ctx: {
        syncDuckHooksImpl: (options) => {
          calls.push({ name: "claude", options });
          return { status: "error", message: "write failed" };
        },
      },
    });

    const result = runtime.syncIntegrationForAgent("claude-code", { source: "settings-agent-enable", automatic: false });

    assert.deepStrictEqual(result, { status: "error", message: "write failed" });
    assert.deepStrictEqual(
      calls.map((entry) => entry.name),
      ["claude"],
      "a failed Settings Enable sync must not leave the directory watcher running for a still-disabled agent"
    );
  });

  it("does not start the Claude watcher when an async sync resolves an error (Settings Install failure)", async () => {
    const { runtime, calls } = makeRuntime({
      ctx: {
        syncDuckHooksImpl: async (options) => {
          calls.push({ name: "claude", options });
          return { status: "error", message: "source script missing" };
        },
      },
    });

    const result = await runtime.syncIntegrationForAgent("claude-code", { source: "settings-agent-install", automatic: false });

    assert.deepStrictEqual(result, { status: "error", message: "source script missing" });
    assert.deepStrictEqual(
      calls.map((entry) => entry.name),
      ["claude"],
      "a failed Settings Install sync must not leave the directory watcher running for a not-yet-installed agent"
    );
  });

  it("startup syncs enabled integrations in the server order and starts the Claude watcher after Claude sync", () => {
    const disabled = new Set(["opencode"]);
    const { runtime, calls } = makeRuntime({
      isAgentEnabled: (agentId) => !disabled.has(agentId),
    });

    runtime.syncEnabledStartupIntegrations();

    assert.deepStrictEqual(calls.map((entry) => entry.name), [
      "claude",
      "watcher:start",
      "codex",
      "pi",
    ]);
  });

  it("startup sync uses installed-and-enabled intent instead of enabled alone", () => {
    const uninstalled = new Set(["claude-code", "pi"]);
    const { runtime, calls } = makeRuntime({
      isAgentEnabled: () => true,
      shouldSyncAgentIntegration: (agentId) => !uninstalled.has(agentId),
    });

    runtime.syncEnabledStartupIntegrations();

    assert.deepStrictEqual(calls.map((entry) => entry.name), [
      "codex",
      "opencode",
    ]);
  });

  // No surviving agent contributes install-time options today, so the syncers
  // themselves take none. What must not rot is the read: startup sync still
  // consults getAgentIntegrationOptions once per agent it syncs
  // (main.js -> server.js -> integration-sync), which is what an agent that
  // needs options would hang off.
  it("reads saved custom integration options during startup sync", () => {
    const optionReads = [];
    const { runtime, calls } = makeRuntime({
      shouldSyncAgentIntegration: (agentId) => agentId === "codex",
      getAgentIntegrationOptions: (agentId) => {
        optionReads.push(agentId);
        return agentId === "codex"
          ? { permissionTarget: { mode: "custom", url: "https://approval.example.test/permission" } }
          : {};
      },
    });

    runtime.syncEnabledStartupIntegrations();

    assert.deepStrictEqual(calls, [{ name: "codex" }]);
    assert.deepStrictEqual(optionReads, ["codex"]);
  });

  it("syncIntegrationForAgent respects Claude management gate", () => {
    const { runtime, calls } = makeRuntime({
      shouldManageClaudeHooks: () => false,
    });

    assert.strictEqual(runtime.syncIntegrationForAgent("claude-code"), false);
    assert.deepStrictEqual(calls, []);
  });

  it("syncIntegrationForAgent starts the Claude watcher after a managed Claude sync", () => {
    const { runtime, calls } = makeRuntime();

    const result = runtime.syncIntegrationForAgent("claude-code");

    assert.deepStrictEqual(result, { status: "ok", source: "claude" });
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["claude", "watcher:start"]);
  });

  it("syncIntegrationForAgent treats count-style zero writes as a missing local integration", () => {
    const cases = [
      {
        agentId: "codex",
        ctxKey: "syncCodexHooksImpl",
        modulePath: "../hooks/codex-install.js",
        exportName: "registerCodexHooks",
        reason: "codex-not-installed",
      },
    ];

    for (const entry of cases) {
      const missing = withPatchedExport(
        entry.modulePath,
        entry.exportName,
        () => ({ added: 0, updated: 0, skipped: 0 }),
        () => {
          const { runtime } = makeRuntime({ ctx: { [entry.ctxKey]: undefined } });
          return runtime.syncIntegrationForAgent(entry.agentId);
        }
      );
      assert.strictEqual(missing.status, "skipped", entry.agentId);
      assert.strictEqual(missing.reason, entry.reason, entry.agentId);

      const alreadyCurrent = withPatchedExport(
        entry.modulePath,
        entry.exportName,
        () => ({ added: 0, updated: 0, skipped: 1 }),
        () => {
          const { runtime } = makeRuntime({ ctx: { [entry.ctxKey]: undefined } });
          return runtime.syncIntegrationForAgent(entry.agentId);
        }
      );
      assert.strictEqual(alreadyCurrent.status, "ok", entry.agentId);
      assert.strictEqual(alreadyCurrent.skipped, 1, entry.agentId);
    }
  });

  it("syncIntegrationForAgent treats installed:false results as skipped", () => {
    const cases = [
      {
        agentId: "pi",
        ctxKey: "syncPiExtensionImpl",
        modulePath: "../hooks/pi-install.js",
        exportName: "registerPiExtension",
        reason: "pi-not-found",
      },
    ];

    const runEntry = (entry, run) => run();

    for (const entry of cases) {
      const missing = withPatchedExport(
        entry.modulePath,
        entry.exportName,
        () => ({ installed: false, skipped: true, updated: false, reason: entry.reason }),
        () => runEntry(entry, () => {
          const { runtime } = makeRuntime({ ctx: { [entry.ctxKey]: undefined } });
          return runtime.syncIntegrationForAgent(entry.agentId);
        })
      );
      assert.strictEqual(missing.status, "skipped", entry.agentId);
      assert.strictEqual(missing.reason, entry.reason, entry.agentId);

      const alreadyCurrent = withPatchedExport(
        entry.modulePath,
        entry.exportName,
        () => ({ installed: true, skipped: true, updated: false }),
        () => runEntry(entry, () => {
          const { runtime } = makeRuntime({ ctx: { [entry.ctxKey]: undefined } });
          return runtime.syncIntegrationForAgent(entry.agentId);
        })
      );
      assert.strictEqual(alreadyCurrent.status, "ok", entry.agentId);
      assert.strictEqual(alreadyCurrent.installed, true, entry.agentId);
    }

    const unmanagedPi = withPatchedExport(
      "../hooks/pi-install.js",
      "registerPiExtension",
      () => ({
        installed: false,
        skipped: true,
        updated: false,
        reason: "unmanaged-existing-extension",
      }),
      () => {
        const { runtime } = makeRuntime({ ctx: { syncPiExtensionImpl: undefined } });
        return runtime.syncIntegrationForAgent("pi");
      }
    );
    assert.strictEqual(unmanagedPi.status, "skipped");
    assert.strictEqual(unmanagedPi.reason, "unmanaged-existing-extension");
    assert.strictEqual(unmanagedPi.message, "Pi integration sync skipped: unmanaged-existing-extension");
  });

  it("syncIntegrationForAgent distinguishes opencode missing from already registered", () => {
    const missing = withPatchedExport(
      "../hooks/opencode-install.js",
      "registerOpencodePlugin",
      () => ({ added: false, skipped: true, created: false, reason: "opencode-not-found" }),
      () => {
        const { runtime } = makeRuntime({ ctx: { syncOpencodePluginImpl: undefined } });
        return runtime.syncIntegrationForAgent("opencode");
      }
    );

    assert.strictEqual(missing.status, "skipped");
    assert.strictEqual(missing.reason, "opencode-not-found");

    const alreadyCurrent = withPatchedExport(
      "../hooks/opencode-install.js",
      "registerOpencodePlugin",
      () => ({ added: false, skipped: true, created: false }),
      () => {
        const { runtime } = makeRuntime({ ctx: { syncOpencodePluginImpl: undefined } });
        return runtime.syncIntegrationForAgent("opencode");
      }
    );

    assert.strictEqual(alreadyCurrent.status, "ok");
    assert.strictEqual(alreadyCurrent.skipped, true);
  });

  it("repairIntegrationForAgent preserves skipped sync results", () => {
    const { runtime } = makeRuntime({
      ctx: {
        syncOpencodePluginImpl: () => ({
          status: "skipped",
          reason: "opencode-not-found",
          message: "opencode missing",
        }),
      },
    });

    const result = runtime.repairIntegrationForAgent("opencode");

    assert.deepStrictEqual(result, {
      status: "skipped",
      reason: "opencode-not-found",
      message: "opencode missing",
    });
  });

  it("uninstallIntegrationForAgent routes through the matching marker-scoped cleaner", () => {
    const uninstallCalls = [];
    const { runtime } = makeRuntime({
      ctx: {
        uninstallIntegrationImpls: {
          opencode: (options) => {
            uninstallCalls.push({ name: "opencode-uninstall", options });
            return { removed: 0, changed: false };
          },
        },
      },
    });

    const result = runtime.uninstallIntegrationForAgent("opencode");

    assert.deepStrictEqual(result, { removed: 0, changed: false });
    assert.deepStrictEqual(uninstallCalls, [{ name: "opencode-uninstall", options: { silent: true } }]);
  });

  it("uninstallIntegrationForAgent passes Codex cleanup markers on the real fallback path", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-codex-cleanup-"));
    try {
      const hooksPath = path.join(homeDir, ".codex", "hooks.json");
      fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
      fs.writeFileSync(hooksPath, JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: '"/node" "/app/hooks/codex-hook.js" SessionStart' }] },
            { hooks: [{ type: "command", command: '"/node" "/other/user-hook.js" SessionStart' }] },
          ],
        },
      }, null, 2), "utf8");
      const { runtime } = makeRuntime({
        ctx: { cleanupHomeDir: homeDir },
      });

      const result = runtime.uninstallIntegrationForAgent("codex");
      const next = JSON.parse(fs.readFileSync(hooksPath, "utf8"));

      assert.deepStrictEqual(
        { removed: result.removed, changed: result.changed },
        { removed: 1, changed: true }
      );
      assert.strictEqual(next.hooks.SessionStart.length, 1);
      assert.ok(next.hooks.SessionStart[0].hooks[0].command.includes("user-hook.js"));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("repairIntegrationForAgent uses Codex repair and passes options through", () => {
    const { runtime, calls, repairOptions } = makeRuntime();

    const result = runtime.repairIntegrationForAgent("codex", { forceCodexHooksFeature: true });

    assert.deepStrictEqual(result, { status: "ok", message: "done" });
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["codex-repair"]);
    assert.deepStrictEqual(repairOptions, [{ forceCodexHooksFeature: true }]);
  });

  it("stopIntegrationForAgent only stops the Claude watcher", () => {
    const { runtime, calls } = makeRuntime();

    assert.strictEqual(runtime.stopIntegrationForAgent("codex"), false);
    assert.strictEqual(runtime.stopIntegrationForAgent("claude-code"), "stopped");
    assert.deepStrictEqual(calls.map((entry) => entry.name), ["watcher:stop"]);
  });

  it("does not log Pi extension sync when the managed files are already current", () => {
    const piInstall = require("../hooks/pi-install");
    const originalRegister = piInstall.registerPiExtension;
    const originalLog = console.log;
    const logs = [];
    piInstall.registerPiExtension = () => ({
      installed: true,
      skipped: false,
      updated: false,
      extensionDir: "C:/Users/Tester/.pi/agent/extensions/duck-on-desk",
    });
    console.log = (message) => logs.push(message);

    try {
      const { runtime } = makeRuntime({ ctx: { syncPiExtensionImpl: undefined } });
      const result = runtime.syncPiExtension();

      assert.strictEqual(result.status, "ok");
      assert.strictEqual(result.installed, true);
      assert.deepStrictEqual(logs, []);
    } finally {
      piInstall.registerPiExtension = originalRegister;
      console.log = originalLog;
    }
  });

});
