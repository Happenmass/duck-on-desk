"use strict";

const test = require("node:test");
const assert = require("node:assert");

const prefs = require("../src/shell/prefs");
const agentCommands = require("../src/shell/settings-actions-agents");
const { commandRegistry } = require("../src/shell/settings-actions");

test("settings agent actions expose the command surface", () => {
  assert.deepStrictEqual(Object.keys(agentCommands).sort(), [
    "AUTO_REPAIRABLE_AGENT_IDS",
    "INSTALLABLE_AGENT_IDS",
    "addCustomApplication",
    "clearAgentCleanupHints",
    "clearAgentInstallHints",
    "deployToWsl",
    "dismissAgentCleanupHints",
    "dismissAgentInstallHints",
    "installAgentIntegration",
    "removeCustomApplication",
    "removeFromWsl",
    "repairAgentIntegration",
    "setAgentCustomDiscoveryPaths",
    "setAgentFlag",
    "setAgentPermissionMode",
    "uninstallAgentIntegration",
  ]);
});

test("settings agent integration commands share a serialization lock", () => {
  assert.strictEqual(agentCommands.setAgentFlag.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.setAgentPermissionMode.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.installAgentIntegration.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.uninstallAgentIntegration.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.repairAgentIntegration.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.setAgentCustomDiscoveryPaths.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.addCustomApplication.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.removeCustomApplication.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.dismissAgentInstallHints.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.dismissAgentCleanupHints.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.clearAgentCleanupHints.lockKey, "agentIntegration");
  assert.strictEqual(agentCommands.clearAgentInstallHints.lockKey, "agentIntegration");
});

test("settings command registry exposes custom AI add, remove, and discovery commands", () => {
  assert.strictEqual(commandRegistry.addCustomApplication, agentCommands.addCustomApplication);
  assert.strictEqual(commandRegistry.removeCustomApplication, agentCommands.removeCustomApplication);
  assert.strictEqual(commandRegistry.setAgentCustomDiscoveryPaths, agentCommands.setAgentCustomDiscoveryPaths);
});

test("settings agent actions add and deduplicate a recognized custom AI", () => {
  const snapshot = prefs.getDefaults();
  const application = {
    id: "custom-nova-ai-0123456789ab",
    name: "Nova AI",
    sourcePath: "C:\\NovaAI",
    executablePath: "C:\\NovaAI\\NovaAI.exe",
    processName: "NovaAI.exe",
    category: "code",
  };
  const result = agentCommands.addCustomApplication({ path: application.sourcePath }, {
    snapshot,
    identifyCustomApplication: () => application,
  });
  assert.deepStrictEqual(result.commit.customApplications, [application]);
  assert.deepStrictEqual(result.commit.agents[application.id], {
    integrationInstalled: false,
    enabled: true,
    permissionsEnabled: false,
    notificationHookEnabled: true,
  });
  assert.strictEqual(result.application.managedIntegration, false);
  assert.strictEqual(result.application.permissionApproval, false);
  const duplicate = agentCommands.addCustomApplication({ path: application.sourcePath }, {
    snapshot: { ...snapshot, customApplications: [application] },
    identifyCustomApplication: () => application,
  });
  assert.strictEqual(duplicate.noop, true);
});

test("settings agent actions reject unidentified paths and clean up removed custom AI", () => {
  const id = "custom-nova-ai-0123456789ab";
  assert.strictEqual(agentCommands.addCustomApplication({ path: "C:\\missing" }, {
    snapshot: prefs.getDefaults(),
    identifyCustomApplication: () => null,
  }).status, "error");
  assert.strictEqual(agentCommands.addCustomApplication({ path: "C:\\bad-id.exe" }, {
    snapshot: prefs.getDefaults(),
    identifyCustomApplication: () => ({
      id: "custom-invalid",
      name: "Invalid",
      sourcePath: "C:\\bad-id.exe",
      executablePath: "C:\\bad-id.exe",
      processName: "bad-id.exe",
    }),
  }).status, "error");
  const calls = [];
  const result = agentCommands.removeCustomApplication({ id }, {
    snapshot: {
      customApplications: [{ id }],
      agents: { [id]: { enabled: true } },
    },
    clearSessionAutomationByAgent: (agentId) => calls.push(["automation", agentId]),
    clearSessionsByAgent: (agentId) => calls.push(["sessions", agentId]),
    dismissPermissionsByAgent: (agentId) => calls.push(["permissions", agentId]),
    clearRecentHookEvents: (agentId) => calls.push(["ring", agentId]),
  });
  assert.deepStrictEqual(result.commit.customApplications, []);
  assert.strictEqual(result.commit.agents[id], undefined);
  assert.deepStrictEqual(calls, [
    ["automation", id],
    ["sessions", id],
    ["permissions", id],
    ["ring", id],
  ]);
});

test("settings agent actions enforce the persisted custom AI limit", () => {
  const application = {
    id: "custom-over-limit-0123456789ab",
    name: "Over Limit",
    sourcePath: "C:\\OverLimit.exe",
    executablePath: "C:\\OverLimit.exe",
    processName: "OverLimit.exe",
    category: "code",
  };
  const current = Array.from({ length: 32 }, (_, index) => ({ id: `custom-app-${String(index).padStart(2, "0")}-0123456789ab` }));
  const result = agentCommands.addCustomApplication({ path: application.sourcePath }, {
    snapshot: { customApplications: current, agents: {} },
    identifyCustomApplication: () => application,
  });
  assert.strictEqual(result.status, "error");
  assert.match(result.message, /limit reached/);
});

test("settings agent actions save custom discovery paths for the shared custom slot", () => {
  const snapshot = prefs.getDefaults();
  const result = agentCommands.setAgentCustomDiscoveryPaths({
    agentId: "custom",
    value: "C:\\Tools\\AI.exe; C:\\Tools\\AI.exe\nC:\\Tools\\AI\\config",
  }, { snapshot });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(result.commit.customToolDiscoveryPaths, [
    "C:\\Tools\\AI.exe",
    "C:\\Tools\\AI\\config",
  ]);
});

test("settings agent actions reject permission gates for custom state-only agents", () => {
  const result = agentCommands.setAgentFlag({
    agentId: "custom-nova-ai-0123456789ab",
    flag: "permissionsEnabled",
    value: true,
  }, { snapshot: prefs.getDefaults() });

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /state-only/);
});

test("settings agent actions preserve semicolons in array paths and reject overflow", () => {
  const snapshot = prefs.getDefaults();
  const valid = agentCommands.setAgentCustomDiscoveryPaths({
    agentId: "custom",
    value: ["C:\\Tools;Lab\\AI.exe"],
  }, { snapshot });
  assert.deepStrictEqual(valid.commit.customToolDiscoveryPaths, ["C:\\Tools;Lab\\AI.exe"]);

  const tooMany = agentCommands.setAgentCustomDiscoveryPaths({
    agentId: "custom",
    value: Array.from({ length: 65 }, (_, index) => `C:\\Tools\\AI-${index}`),
  }, { snapshot });
  assert.strictEqual(tooMany.status, "error");
  assert.match(tooMany.message, /limit reached/);

  const tooLong = agentCommands.setAgentCustomDiscoveryPaths({
    agentId: "custom",
    value: [`C:\\${"x".repeat(2050)}`],
  }, { snapshot });
  assert.strictEqual(tooLong.status, "error");
  assert.match(tooLong.message, /at most/);
});

test("settings agent actions enable an agent and preserve sibling flags", () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.codex = {
    enabled: false,
    permissionsEnabled: false,
    notificationHookEnabled: true,
    permissionMode: "intercept",
  };
  const calls = {
    syncIntegrationForAgent: [],
    startMonitorForAgent: [],
    writeCodexAutoStartGate: [],
  };
  const deps = {
    snapshot,
    syncIntegrationForAgent: (agentId) => calls.syncIntegrationForAgent.push(agentId),
    startMonitorForAgent: (agentId) => calls.startMonitorForAgent.push(agentId),
    writeCodexAutoStartGate: (enabled) => {
      calls.writeCodexAutoStartGate.push(enabled);
      return true;
    },
  };

  const result = agentCommands.setAgentFlag(
    { agentId: "codex", flag: "enabled", value: true },
    deps
  );

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls.syncIntegrationForAgent, ["codex"]);
  assert.deepStrictEqual(calls.startMonitorForAgent, ["codex"]);
  assert.deepStrictEqual(
    calls.writeCodexAutoStartGate,
    [],
    "the post-commit agents subscriber publishes the enabled gate"
  );
  assert.strictEqual(result.commit.agents.codex.enabled, true);
  assert.strictEqual(result.commit.agents.codex.permissionsEnabled, false);
  assert.strictEqual(result.commit.agents.codex.notificationHookEnabled, true);
  assert.strictEqual(result.commit.agents.codex.permissionMode, "intercept");
});

test("settings agent actions fail closed when the Codex auto-start gate cannot sync", () => {
  const snapshot = prefs.getDefaults();
  const calls = [];
  const result = agentCommands.setAgentFlag(
    { agentId: "codex", flag: "enabled", value: false },
    {
      snapshot,
      writeCodexAutoStartGate: (enabled) => {
        calls.push(enabled);
        return false;
      },
      stopMonitorForAgent: () => calls.push("stop"),
    }
  );

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /auto-start gate/);
  assert.deepStrictEqual(calls, [false]);
  assert.strictEqual(result.commit, undefined);
});

test("settings agent actions persist the disabled Codex gate before runtime cleanup", () => {
  const snapshot = prefs.getDefaults();
  const calls = [];
  const result = agentCommands.setAgentFlag(
    { agentId: "codex", flag: "enabled", value: false },
    {
      snapshot,
      writeCodexAutoStartGate: (enabled) => {
        calls.push(`gate:${enabled}`);
        return true;
      },
      stopMonitorForAgent: () => calls.push("stop"),
      clearSessionAutomationByAgent: () => calls.push("automation"),
      clearSessionsByAgent: () => calls.push("sessions"),
      dismissPermissionsByAgent: () => calls.push("permissions"),
    }
  );

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls, [
    "gate:false",
    "stop",
    "automation",
    "sessions",
    "permissions",
  ]);
  assert.strictEqual(result.commit.agents.codex.enabled, false);
});

test("disabling an agent clears session automation before sessions and permissions", () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents["opencode"] = {
    integrationInstalled: true,
    enabled: true,
    permissionsEnabled: true,
    notificationHookEnabled: true,
  };
  const calls = [];
  const result = agentCommands.setAgentFlag(
    { agentId: "opencode", flag: "enabled", value: false },
    {
      snapshot,
      stopMonitorForAgent: (id) => calls.push(`stop:${id}`),
      clearSessionAutomationByAgent: (id) => calls.push(`automation:${id}`),
      clearSessionsByAgent: (id) => calls.push(`sessions:${id}`),
      dismissPermissionsByAgent: (id) => calls.push(`permissions:${id}`),
    }
  );
  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls, [
    "stop:opencode",
    "automation:opencode",
    "sessions:opencode",
    "permissions:opencode",
  ]);
});

test("settings agent actions do not install files when enabling an uninstalled agent", () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents["pi"] = {
    integrationInstalled: false,
    enabled: false,
    permissionsEnabled: true,
    notificationHookEnabled: true,
  };
  const calls = {
    syncIntegrationForAgent: [],
    startMonitorForAgent: [],
  };
  const deps = {
    snapshot,
    syncIntegrationForAgent: (agentId) => calls.syncIntegrationForAgent.push(agentId),
    startMonitorForAgent: (agentId) => calls.startMonitorForAgent.push(agentId),
  };

  const result = agentCommands.setAgentFlag(
    { agentId: "pi", flag: "enabled", value: true },
    deps
  );

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls.syncIntegrationForAgent, []);
  assert.deepStrictEqual(calls.startMonitorForAgent, ["pi"]);
  assert.strictEqual(result.commit.agents["pi"].enabled, true);
  assert.strictEqual(result.commit.agents["pi"].integrationInstalled, false);
});

test("settings agent actions await the Claude enable queue before starting the monitor or committing", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents["claude-code"] = {
    integrationInstalled: true,
    enabled: false,
    permissionsEnabled: true,
    notificationHookEnabled: true,
  };
  let resolveSync;
  const calls = { syncIntegrationForAgent: [], startMonitorForAgent: [] };
  const deps = {
    snapshot,
    syncIntegrationForAgent: (agentId, options) => {
      calls.syncIntegrationForAgent.push({ agentId, options });
      return new Promise((resolve) => { resolveSync = resolve; });
    },
    startMonitorForAgent: (agentId) => calls.startMonitorForAgent.push(agentId),
  };

  const pending = agentCommands.setAgentFlag({ agentId: "claude-code", flag: "enabled", value: true }, deps);
  assert.ok(typeof pending.then === "function", "claude-code enable must return a Promise");

  // setAgentFlag's async branch reaches deps.syncIntegrationForAgent one
  // microtask tick later (Promise.resolve().then(...)); flush that tick
  // before asserting the monitor hasn't started and grabbing resolveSync.
  await Promise.resolve();
  assert.deepStrictEqual(calls.startMonitorForAgent, [], "monitor must not start before the queue settles");

  resolveSync({ status: "ok" });
  const result = await pending;

  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.commit.agents["claude-code"].enabled, true);
  assert.deepStrictEqual(calls.startMonitorForAgent, ["claude-code"]);
  assert.deepStrictEqual(calls.syncIntegrationForAgent, [
    { agentId: "claude-code", options: { source: "settings-agent-enable", automatic: false } },
  ]);
});

test("settings agent actions do not commit or start the monitor when the Claude enable queue fails", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents["claude-code"] = {
    integrationInstalled: true,
    enabled: false,
    permissionsEnabled: true,
  };
  const calls = { startMonitorForAgent: [] };
  const deps = {
    snapshot,
    syncIntegrationForAgent: async () => ({ status: "error", message: "write failed" }),
    startMonitorForAgent: (agentId) => calls.startMonitorForAgent.push(agentId),
  };

  const result = await agentCommands.setAgentFlag({ agentId: "claude-code", flag: "enabled", value: true }, deps);

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /write failed/);
  assert.strictEqual(result.commit, undefined);
  assert.deepStrictEqual(calls.startMonitorForAgent, []);
});

test("settings agent actions keep Claude enable synchronous when the integration is not installed", () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents["claude-code"] = {
    integrationInstalled: false,
    enabled: false,
    permissionsEnabled: true,
  };
  const calls = { syncIntegrationForAgent: [], startMonitorForAgent: [] };
  const deps = {
    snapshot,
    syncIntegrationForAgent: (agentId) => calls.syncIntegrationForAgent.push(agentId),
    startMonitorForAgent: (agentId) => calls.startMonitorForAgent.push(agentId),
  };

  const result = agentCommands.setAgentFlag({ agentId: "claude-code", flag: "enabled", value: true }, deps);

  assert.strictEqual(typeof result.then, "undefined", "must stay synchronous when Claude is not installed");
  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls.syncIntegrationForAgent, []);
  assert.deepStrictEqual(calls.startMonitorForAgent, ["claude-code"]);
});

test("settings agent actions install Claude Code with the settings-agent-install source, non-automatic", async () => {
  const calls = [];
  const result = await agentCommands.installAgentIntegration({ agentId: "claude-code" }, {
    snapshot: prefs.getDefaults(),
    syncIntegrationForAgent: async (agentId, options) => {
      calls.push({ agentId, options });
      return { status: "ok" };
    },
  });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls, [
    { agentId: "claude-code", options: { source: "settings-agent-install", automatic: false } },
  ]);
});

test("settings agent actions switch Codex permission mode and dismiss pending bubbles", () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.codex.permissionMode = "intercept";
  const calls = { dismissPermissionsByAgent: [] };
  const deps = {
    snapshot,
    dismissPermissionsByAgent: (agentId) => calls.dismissPermissionsByAgent.push(agentId),
  };

  const result = agentCommands.setAgentPermissionMode(
    { agentId: "codex", mode: "native" },
    deps
  );

  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.commit.agents.codex.permissionMode, "native");
  assert.strictEqual(result.commit.agents.codex.enabled, true);
  assert.deepStrictEqual(calls.dismissPermissionsByAgent, ["codex"]);
});

test("settings agent actions repair Codex with the forced hooks feature option", async () => {
  const snapshot = prefs.getDefaults();
  const calls = [];
  const deps = {
    snapshot,
    repairIntegrationForAgent: async (agentId, options) => {
      calls.push({ agentId, options });
      return { status: "ok", message: "codex repaired" };
    },
  };

  const result = await agentCommands.repairAgentIntegration(
    { agentId: "codex", forceCodexHooksFeature: true },
    deps
  );

  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.message, "codex repaired");
  assert.deepStrictEqual(calls, [
    { agentId: "codex", options: { forceCodexHooksFeature: true } },
  ]);
});

test("settings agent actions defer the enabled Codex gate on install but disable it before uninstall", async () => {
  const installSnapshot = prefs.getDefaults();
  installSnapshot.agents.codex.integrationInstalled = false;
  installSnapshot.agents.codex.enabled = false;
  const calls = [];
  const installed = await agentCommands.installAgentIntegration({ agentId: "codex" }, {
    snapshot: installSnapshot,
    syncIntegrationForAgent: async () => ({ status: "ok" }),
    writeCodexAutoStartGate: (enabled) => {
      calls.push(`install:${enabled}`);
      return true;
    },
  });
  assert.strictEqual(installed.status, "ok");
  assert.strictEqual(installed.commit.agents.codex.enabled, true);

  const uninstallSnapshot = prefs.getDefaults();
  const uninstalled = await agentCommands.uninstallAgentIntegration({ agentId: "codex" }, {
    snapshot: uninstallSnapshot,
    writeCodexAutoStartGate: (enabled) => {
      calls.push(`uninstall:${enabled}`);
      return true;
    },
    uninstallIntegrationForAgent: async () => ({ status: "ok" }),
  });
  assert.strictEqual(uninstalled.status, "ok");
  assert.strictEqual(uninstalled.commit.agents.codex.enabled, false);
  assert.deepStrictEqual(calls, ["uninstall:false"]);
});

test("settings agent actions report repair payload errors with the repair command name", async () => {
  const result = await agentCommands.repairAgentIntegration({}, {
    snapshot: prefs.getDefaults(),
    repairIntegrationForAgent: async () => {
      throw new Error("should not run");
    },
  });

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /repairAgentIntegration\.agentId/);
});

test("every opencode-family member is installable AND auto-repairable (R10 P3)", () => {
  // AUTO_REPAIRABLE_AGENT_IDS gates repairAgentIntegration; INSTALLABLE
  // gates install/uninstall. Dropping a family member from either set turns
  // the Settings/Doctor Repair buttons into "no automatic repair available"
  // with every other test green (GPT-5.5 review mutation).
  const { OPENCODE_FAMILY } = require("../agents/opencode-family");
  for (const agentId of Object.keys(OPENCODE_FAMILY)) {
    assert.ok(
      agentCommands.INSTALLABLE_AGENT_IDS.has(agentId),
      `${agentId} missing from INSTALLABLE_AGENT_IDS`
    );
    assert.ok(
      agentCommands.AUTO_REPAIRABLE_AGENT_IDS.has(agentId),
      `${agentId} missing from AUTO_REPAIRABLE_AGENT_IDS`
    );
  }
});

test("settings agent actions save discovery overrides on a registered agent", () => {
  const snapshot = prefs.getDefaults();
  const result = agentCommands.setAgentCustomDiscoveryPaths({
    agentId: "opencode",
    value: "C:\\Tools\\OpenCode",
  }, { snapshot });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(result.commit.agents.opencode.customDiscoveryPaths, ["C:\\Tools\\OpenCode"]);
  assert.strictEqual(result.commit.customToolDiscoveryPaths, undefined);
});

test("settings agent actions install an integration and enable ingress", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.opencode = {
    integrationInstalled: false,
    enabled: false,
    permissionsEnabled: true,
    notificationHookEnabled: true,
  };
  const calls = [];
  const deps = {
    snapshot,
    syncIntegrationForAgent: async (agentId) => {
      calls.push(agentId);
      return { status: "ok", message: "installed" };
    },
    startMonitorForAgent: (agentId) => calls.push(`monitor:${agentId}`),
  };

  const result = await agentCommands.installAgentIntegration({ agentId: "opencode" }, deps);

  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.message, "installed");
  assert.deepStrictEqual(calls, ["opencode", "monitor:opencode"]);
  assert.strictEqual(result.commit.agents.opencode.integrationInstalled, true);
  assert.strictEqual(result.commit.agents.opencode.enabled, true);
  assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, {});
  assert.deepStrictEqual(result.commit.dismissedAgentCleanupHints, {});
});

test("settings agent actions clear hint dismissals after a manual install", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.dismissedAgentInstallHints = { opencode: true, pi: true };
  snapshot.dismissedAgentCleanupHints = { opencode: true, pi: true };

  const result = await agentCommands.installAgentIntegration({ agentId: "opencode" }, {
    snapshot,
    syncIntegrationForAgent: async () => ({ status: "ok" }),
  });

  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.commit.agents.opencode.integrationInstalled, true);
  assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, { pi: true });
  assert.deepStrictEqual(result.commit.dismissedAgentCleanupHints, { pi: true });
});

test("settings agent actions return skipped without committing installed intent when install skips", async () => {
  const result = await agentCommands.installAgentIntegration({ agentId: "pi" }, {
    snapshot: prefs.getDefaults(),
    syncIntegrationForAgent: async () => ({ status: "skipped", message: "Pi missing" }),
  });

  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.commit, undefined);
  assert.match(result.message, /Pi missing/);
});

test("settings agent actions uninstall an integration and disable ingress", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.opencode = {
    integrationInstalled: true,
    enabled: true,
    permissionsEnabled: true,
    notificationHookEnabled: true,
  };
  snapshot.dismissedAgentCleanupHints = { opencode: true, pi: true };
  const calls = [];
  const deps = {
    snapshot,
    uninstallIntegrationForAgent: async (agentId) => {
      calls.push(agentId);
      return { removed: 0, changed: false };
    },
    stopMonitorForAgent: (agentId) => calls.push(`stop:${agentId}`),
    clearSessionAutomationByAgent: (agentId) => calls.push(`automation:${agentId}`),
    clearSessionsByAgent: (agentId) => calls.push(`clear:${agentId}`),
    dismissPermissionsByAgent: (agentId) => calls.push(`dismiss:${agentId}`),
  };

  const result = await agentCommands.uninstallAgentIntegration({ agentId: "opencode" }, deps);

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(calls, [
    "opencode",
    "stop:opencode",
    "automation:opencode",
    "clear:opencode",
    "dismiss:opencode",
  ]);
  assert.strictEqual(result.commit.agents.opencode.integrationInstalled, false);
  assert.strictEqual(result.commit.agents.opencode.enabled, false);
  assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, { opencode: true });
  assert.deepStrictEqual(result.commit.dismissedAgentCleanupHints, { pi: true });
});

test("settings agent actions can uninstall without suppressing the next install hint", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.opencode = {
    integrationInstalled: true,
    enabled: true,
    permissionsEnabled: true,
    notificationHookEnabled: true,
  };
  snapshot.dismissedAgentInstallHints = { opencode: true, pi: true };

  const result = await agentCommands.uninstallAgentIntegration({
    agentId: "opencode",
    dismissInstallHint: false,
  }, {
    snapshot,
    uninstallIntegrationForAgent: async () => ({ status: "ok" }),
  });

  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.commit.agents.opencode.integrationInstalled, false);
  assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, { pi: true });
});

test("settings agent actions dismiss agent install hints in one commit", () => {
  const snapshot = prefs.getDefaults();
  snapshot.dismissedAgentInstallHints = { pi: true };

  const result = agentCommands.dismissAgentInstallHints({
    agentIds: ["opencode", "pi", "opencode"],
  }, { snapshot });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, {
    pi: true,
    opencode: true,
  });
});

test("settings agent actions dismiss agent cleanup hints in one commit", () => {
  const snapshot = prefs.getDefaults();
  snapshot.dismissedAgentCleanupHints = { pi: true };

  const result = agentCommands.dismissAgentCleanupHints({
    agentIds: ["opencode", "pi", "opencode"],
  }, { snapshot });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(result.commit.dismissedAgentCleanupHints, {
    pi: true,
    opencode: true,
  });
});

test("settings agent actions clear agent cleanup hints in one commit", () => {
  const snapshot = prefs.getDefaults();
  snapshot.dismissedAgentCleanupHints = { opencode: true, pi: true };

  const result = agentCommands.clearAgentCleanupHints({
    agentIds: ["opencode", "codex"],
  }, { snapshot });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(result.commit.dismissedAgentCleanupHints, { pi: true });
});

test("settings agent actions clear agent install hints in one commit", () => {
  const snapshot = prefs.getDefaults();
  snapshot.dismissedAgentInstallHints = { opencode: true, pi: true };

  const result = agentCommands.clearAgentInstallHints({
    agentIds: ["opencode", "codex"],
  }, { snapshot });

  assert.strictEqual(result.status, "ok");
  assert.deepStrictEqual(result.commit.dismissedAgentInstallHints, { pi: true });
});

test("settings agent actions do not commit uninstall failures", async () => {
  const result = await agentCommands.uninstallAgentIntegration({ agentId: "opencode" }, {
    snapshot: prefs.getDefaults(),
    uninstallIntegrationForAgent: async () => ({ status: "error", message: "write failed" }),
  });

  assert.strictEqual(result.status, "error");
  assert.strictEqual(result.commit, undefined);
  assert.match(result.message, /write failed/);
});

test("settings agent actions block repair for uninstalled integrations", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.opencode.integrationInstalled = false;
  snapshot.agents.opencode.enabled = true;
  const result = await agentCommands.repairAgentIntegration({ agentId: "opencode" }, {
    snapshot,
    repairIntegrationForAgent: async () => {
      throw new Error("should not run");
    },
  });

  assert.strictEqual(result.status, "error");
  assert.match(result.message, /not installed/);
});

test("successful Codex WSL Pair reports ok with warning and connectivity, without committing prefs", async () => {
  const snapshot = prefs.getDefaults();
  const seen = [];
  const result = await agentCommands.deployToWsl({ agentId: "codex", distro: "Ubuntu" }, {
    snapshot,
    deployHooksToWsl: async (distro, agentId) => {
      seen.push([distro, agentId]);
      return { ok: true, distro, agentId, message: "Codex hooks installed", warning: "one profile failed", connectivity: false };
    },
  });

  assert.deepStrictEqual(seen, [["Ubuntu", "codex"]]);
  assert.strictEqual(result.status, "ok", "warning must stay top-level ok");
  assert.strictEqual(result.message, "Codex hooks installed");
  assert.strictEqual(result.warning, "one profile failed");
  assert.strictEqual(result.wslConnectivity, false);
  assert.strictEqual(result.commit, undefined, "WSL pairing is not a Windows-local install");
});

test("successful Codex WSL Pair falls back to the default message and omits absent connectivity", async () => {
  const result = await agentCommands.deployToWsl({ agentId: "codex", distro: "Ubuntu" }, {
    snapshot: prefs.getDefaults(),
    deployHooksToWsl: async () => ({ ok: true }),
  });
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.message, "Deployed to WSL Ubuntu");
  assert.strictEqual("wslConnectivity" in result, false);
  assert.strictEqual("warning" in result, false);
});

test("failed Codex WSL Pair does not open ingress", async () => {
  const result = await agentCommands.deployToWsl({ agentId: "codex", distro: "Ubuntu" }, {
    snapshot: prefs.getDefaults(),
    deployHooksToWsl: async () => ({ ok: false, message: "enable failed" }),
  });
  assert.strictEqual(result.status, "error");
  assert.strictEqual(result.commit, undefined);
  assert.match(result.message, /enable failed/);
});

test("Codex WSL Unpair propagates warnings without disabling the global gate", async () => {
  const snapshot = prefs.getDefaults();
  snapshot.agents.codex.enabled = true;
  const result = await agentCommands.removeFromWsl({ agentId: "codex", distro: "Ubuntu" }, {
    snapshot,
    removeHooksFromWsl: async () => ({ ok: true, message: "removed", warning: "disable failed" }),
  });
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.warning, "disable failed");
  assert.strictEqual(result.commit, undefined);
  assert.strictEqual(snapshot.agents.codex.enabled, true);
});

test("WSL commands report a missing dependency instead of throwing", async () => {
  const result = await agentCommands.deployToWsl({ agentId: "codex", distro: "Ubuntu" }, { snapshot: prefs.getDefaults() });
  assert.strictEqual(result.status, "error");
  assert.match(result.message, /deployHooksToWsl dep not available/);
});
