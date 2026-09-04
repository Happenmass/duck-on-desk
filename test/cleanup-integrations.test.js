const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  AGENT_CLEANERS,
  AGENT_DISPLAY_NAMES,
  MANAGED_AGENT_IDS,
  buildCleanupOptionsForHome,
  cleanupIntegrations,
} = require("../hooks/cleanup-integrations");
const { resolvePluginDir } = require("../hooks/opencode-install");
const { registerCodexHooks, CODEX_OFFICIAL_HOOK_EVENTS } = require("../hooks/codex-install");
const { stableCodexHookPaths } = require("../hooks/codex-install-utils");
const agentCommands = require("../src/settings-actions-agents");
const { MANAGED_CLEANUP_AGENT_IDS, commandRegistry } = require("../src/settings-actions");
const { createIntegrationSyncRuntime } = require("../src/integration-sync");
const prefs = require("../src/prefs");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listCleanupBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.includes(".clawd-cleanup-") && name.endsWith(".bak"));
}

describe("cleanupIntegrations", () => {
  it("builds explicit cleanup path overrides for every managed agent", () => {
    const homeDir = path.join(os.tmpdir(), "clawd-target-home");
    const inheritedLocalAppData = path.join(os.tmpdir(), "admin-local-appdata");
    const targetLocalAppData = path.join(homeDir, "AppData", "Local");
    const targetAppData = path.join(homeDir, "AppData", "Roaming");
    const plan = buildCleanupOptionsForHome(homeDir, {
      env: {
        LOCALAPPDATA: inheritedLocalAppData,
        APPDATA: path.join(os.tmpdir(), "admin-appdata"),
      },
      platform: "win32",
    });
    const missing = MANAGED_AGENT_IDS.filter((agentId) => !plan.byAgent[agentId]);

    assert.deepStrictEqual(missing, []);
    for (const agentId of MANAGED_AGENT_IDS) {
      assert.notStrictEqual(plan.byAgent[agentId], plan.common, `${agentId} must not fall back to common options`);
    }
    assert.strictEqual(plan.byAgent["claude-code"].settingsPath, path.join(homeDir, ".claude", "settings.json"));
    assert.strictEqual(plan.byAgent.codex.hooksPath, path.join(homeDir, ".codex", "hooks.json"));
    assert.strictEqual(plan.byAgent.opencode.configPath, path.join(homeDir, ".config", "opencode", "opencode.json"));
    assert.strictEqual(plan.byAgent.pi.parentDir, path.join(homeDir, ".pi", "agent"));
    assert.strictEqual(plan.env.LOCALAPPDATA, targetLocalAppData);
    assert.strictEqual(plan.env.APPDATA, targetAppData);
  });

  it("cleans hooks and stable launchers from an explicit custom CODEX_HOME", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-cleanup-custom-codex-"));
    const homeDir = path.join(root, "home");
    const codexDir = path.join(root, "custom-codex");
    fs.mkdirSync(codexDir, { recursive: true });

    try {
      registerCodexHooks({
        silent: true,
        codexDir,
        nodeBin: process.execPath,
        platform: process.platform,
      });
      const stableDir = stableCodexHookPaths(codexDir).stableDir;
      assert.strictEqual(fs.existsSync(stableDir), true);

      const result = await cleanupIntegrations({
        homeDir,
        env: { CODEX_HOME: codexDir },
        backup: true,
        silent: true,
        hermesCommand: false,
      });
      const codex = result.agents.find((entry) => entry.agentId === "codex");

      assert.strictEqual(codex.status, "applied");
      assert.strictEqual(codex.removed, CODEX_OFFICIAL_HOOK_EVENTS.length);
      assert.strictEqual(fs.existsSync(stableDir), false);
      assert.deepStrictEqual(readJson(path.join(codexDir, "hooks.json")).hooks, {});
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes managed hooks/plugins safely, backs up once, and is idempotent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-cleanup-"));
    const homeDir = path.join(root, "home");
    const pluginDir = resolvePluginDir();
    const codexPath = path.join(homeDir, ".codex", "hooks.json");
    const opencodePath = path.join(homeDir, ".config", "opencode", "opencode.json");

    writeJson(codexPath, {
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: 'node "C:/clawd/hooks/codex-hook.js"' }] },
          { hooks: [{ type: "command", command: 'node "C:/clawd/hooks/codex-debug-hook.js"' }] },
          { hooks: [{ type: "command", command: 'node "C:/user/hooks/keep.js"' }] },
        ],
      },
    });
    writeJson(opencodePath, {
      plugin: [
        pluginDir,
        "/somewhere/opencode-plugin",
        "opencode-wakatime",
      ],
    });

    try {
      const result = await cleanupIntegrations({ homeDir, backup: true, silent: true });
      assert.strictEqual(result.summary.failed, 0);
      assert.ok(result.summary.entriesRemoved >= 3);

      const codex = readJson(codexPath);
      assert.deepStrictEqual(codex.hooks.Stop, [
        { hooks: [{ type: "command", command: 'node "C:/user/hooks/keep.js"' }] },
      ]);
      assert.strictEqual(listCleanupBackups(path.dirname(codexPath)).length, 1);

      const opencode = readJson(opencodePath);
      // #825 behavior change: opencode now routes through the shared JSONC
      // editor, so uninstall claims exactly what install claims — an exact
      // path match OR an ABSOLUTE path whose basename is the managed plugin
      // dir. "/somewhere/opencode-plugin" is a stale Clawd install location
      // (register rewrites it in place, hooks/opencode-family-install.js:150),
      // so leaving it behind was residue Clawd itself created. Third-party
      // npm specifiers are never absolute paths and stay untouched.
      assert.deepStrictEqual(opencode.plugin, ["opencode-wakatime"]);
      assert.strictEqual(listCleanupBackups(path.dirname(opencodePath)).length, 1);

      const backupCounts = {
        codex: listCleanupBackups(path.dirname(codexPath)).length,
        opencode: listCleanupBackups(path.dirname(opencodePath)).length,
      };
      const second = await cleanupIntegrations({ homeDir, backup: true, silent: true });
      assert.strictEqual(second.summary.failed, 0);
      assert.strictEqual(second.summary.entriesRemoved, 0);
      assert.deepStrictEqual({
        codex: listCleanupBackups(path.dirname(codexPath)).length,
        opencode: listCleanupBackups(path.dirname(opencodePath)).length,
      }, backupCounts);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records a precomputed Claude cleanup result instead of unregistering Claude a second time", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-cleanup-claude-"));
    const homeDir = path.join(root, "home");
    const claudeSettingsPath = path.join(homeDir, ".claude", "settings.json");
    // A real Clawd hook that WOULD be removed if the generic claude-code
    // cleaner ran — asserting it survives proves the precomputed result path
    // is taken instead of a second, queue-external unregister.
    writeJson(claudeSettingsPath, {
      hooks: {
        Stop: [{ matcher: "", hooks: [{ type: "command", command: 'node "C:/clawd/hooks/clawd-hook.js" Stop' }] }],
      },
    });

    try {
      const result = await cleanupIntegrations({
        homeDir,
        backup: true,
        silent: true,
        hermesCommand: false,
        claudeCleanupResult: { status: "ok", removed: 3, changed: true, backupPaths: ["/fake/backup.bak"] },
      });

      const claudeAgent = result.agents.find((agent) => agent.agentId === "claude-code");
      assert.strictEqual(claudeAgent.status, "applied");
      assert.strictEqual(claudeAgent.removed, 3);
      assert.deepStrictEqual(claudeAgent.backupPaths, ["/fake/backup.bak"]);
      assert.strictEqual(result.summary.entriesRemoved >= 3, true);

      const settingsAfter = readJson(claudeSettingsPath);
      assert.ok(
        settingsAfter.hooks.Stop.some((entry) => entry.hooks.some((h) => h.command.includes("clawd-hook.js"))),
        "the real settings.json must be untouched — the precomputed result replaces a second unregister call"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ── Cross-list completeness ────────────────────────────────────────────────
  // #843: cleanup kept its OWN managed list, so an agent could be added to
  // INSTALLABLE_AGENT_IDS (Settings Install/Uninstall) and to
  // MANAGED_CLEANUP_AGENT_IDS (About cleanup flips the prefs flags) while
  // cleanup-integrations silently had no cleaner for it. Every list-driven test
  // in this file iterates MANAGED_AGENT_IDS, so the gap self-certified as green:
  // the missing agent simply was not iterated. Lock the three lists together.
  it("keeps MANAGED_AGENT_IDS in lockstep with the installable and About-cleanup lists", () => {
    const managed = [...MANAGED_AGENT_IDS].sort();
    const installable = [...agentCommands.INSTALLABLE_AGENT_IDS].sort();
    const aboutCleanup = [...MANAGED_CLEANUP_AGENT_IDS].sort();

    assert.deepStrictEqual(
      managed,
      installable,
      "an agent Settings can Install/Uninstall must have a cleanup entry here — otherwise "
      + "integration-sync's real uninstall fallback returns false and the hooks stay on disk"
    );
    assert.deepStrictEqual(
      managed,
      aboutCleanup,
      "About cleanup flips integrationInstalled/enabled to false for every MANAGED_CLEANUP_AGENT_ID; "
      + "any id missing here would leave prefs claiming uninstalled while the hooks survive"
    );
  });

  it("gives every managed agent a cleaner, path overrides and a display name", () => {
    const homeDir = path.join(os.tmpdir(), "clawd-cleanup-completeness-home");
    const plan = buildCleanupOptionsForHome(homeDir, { hermesCommand: false, silent: true });

    const missingCleaner = MANAGED_AGENT_IDS.filter((id) => typeof AGENT_CLEANERS[id] !== "function");
    const missingOptions = MANAGED_AGENT_IDS.filter((id) => !plan.byAgent[id]);
    const missingDisplayName = MANAGED_AGENT_IDS.filter((id) => !AGENT_DISPLAY_NAMES[id]);

    // These three are exactly what integration-sync's real uninstall fallback
    // dereferences before it can uninstall anything.
    assert.deepStrictEqual(missingCleaner, []);
    assert.deepStrictEqual(missingOptions, []);
    assert.deepStrictEqual(missingDisplayName, []);
  });

  it("marks the claude-code agent failed when the precomputed cleanup result is an error", async () => {
    const homeDir = path.join(os.tmpdir(), "clawd-cleanup-claude-error-home");
    const result = await cleanupIntegrations({
      homeDir,
      backup: true,
      silent: true,
      hermesCommand: false,
      claudeCleanupResult: { status: "error", message: "queue disposed" },
    });

    const claudeAgent = result.agents.find((agent) => agent.agentId === "claude-code");
    assert.strictEqual(claudeAgent.status, "failed");
    assert.strictEqual(claudeAgent.error, "queue disposed");
    assert.strictEqual(result.summary.failed >= 1, true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// #843 — QwenWork uninstall must close the loop all the way to disk.
//
// The PR wired qwenwork into INSTALLABLE_AGENT_IDS (Settings Install/Uninstall)
// and MANAGED_CLEANUP_AGENT_IDS (About cleanup), but not into
// cleanup-integrations. integration-sync's REAL uninstall fallback resolves its
// cleaner from AGENT_CLEANERS, so Uninstall returned
// "No automatic integration uninstall is available for qwenwork" and About
// cleanup flipped the prefs flags to false while ~/.QwenWorkCN/settings.json
// kept every Clawd hook. These tests run the real fallback — an injected fake
// uninstall impl would have passed against the broken build.
// ═════════════════════════════════════════════════════════════════════════════
