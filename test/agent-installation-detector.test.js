"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  detectAgentInstallation,
  detectAgentInstallations,
} = require("../src/agent-installation-detector");
const { getAgentDescriptor } = require("../src/doctor-detectors/agent-descriptors");
const tempDirs = [];

function makeHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-agent-detect-"));
  tempDirs.push(dir);
  return dir;
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function canonicalRealpath(filePath) {
  return fs.realpathSync.native
    ? fs.realpathSync.native(filePath)
    : fs.realpathSync(filePath);
}

function writeText(filePath, value = "") {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

function byId(report, agentId) {
  return report.agents.find((entry) => entry.agentId === agentId);
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("agent installation detector", () => {
  // #895 T11a/T11b: only Claude is skipped. Its parent dir is created by Duck's
  // own default sync, so ~/.claude proves nothing; ~/.codex is never created by
  // Duck, so it stays real evidence and Codex must be reported like any other
  // agent. This is one code-level route consistent with #895; the reporter's
  // exact on-disk layout remains unconfirmed.
  it("skips only the agent whose parent dir Duck creates itself", () => {
    const homeDir = makeHome();

    const report = detectAgentInstallations({ homeDir, now: 12345 });

    assert.strictEqual(report.checkedAt, 12345);
    assert.deepStrictEqual(report.skippedAgentIds, ["claude-code"]);
    assert.ok(!byId(report, "claude-code"));
    assert.ok(byId(report, "opencode"));

    // Present in the report, and honestly negative on an empty home.
    const codex = byId(report, "codex");
    assert.ok(codex, "codex must be examined, not skipped");
    assert.strictEqual(codex.detectedInstalled, false);
    assert.strictEqual(codex.confidence, "low");
    assert.strictEqual(codex.reason, "not-found");
  });

  it("reports Codex from its own directory once it exists", () => {
    const homeDir = makeHome();
    mkdirp(path.join(homeDir, ".codex"));

    const codex = byId(detectAgentInstallations({ homeDir, now: 1 }), "codex");

    assert.strictEqual(codex.detectedInstalled, true);
    assert.strictEqual(codex.confidence, "medium");
    assert.strictEqual(codex.reason, "parent-dir");
  });

  // #895 T11c: the whole reason Codex may be detected from its directory is that
  // Duck never creates it. Claude's installer does, which is why Claude stays
  // skipped. If either half of that asymmetry ever changes, this fails.
  it("keeps the create-vs-skip asymmetry the skip list is derived from", async () => {
    const codexHome = makeHome();
    const codexDir = path.join(codexHome, ".codex");
    require("../hooks/codex-install.js").registerCodexHooks({ silent: true, env: { CODEX_HOME: codexDir } });
    assert.strictEqual(fs.existsSync(codexDir), false, "Codex sync must not create ~/.codex");

    const claudeHome = makeHome();
    const claudeSettings = path.join(claudeHome, ".claude", "settings.json");
    await require("../hooks/install.js").registerHooksAsync({
      silent: true,
      homeDir: claudeHome,
      nodeBin: process.execPath,
      claudeVersionInfo: { version: "2.1.78", source: "test", status: "known" },
    });
    assert.strictEqual(fs.existsSync(claudeSettings), true, "Claude's production async sync creates ~/.claude");
  });

  it("uses only read-style fs operations", () => {
    const homeDir = makeHome();
    mkdirp(path.join(homeDir, ".config", "opencode"));
    const fsReadOnly = new Proxy({
      statSync: fs.statSync,
      lstatSync: fs.lstatSync,
      readFileSync: fs.readFileSync,
      readdirSync: fs.readdirSync,
    }, {
      get(target, property) {
        if (property in target) return target[property];
        throw new Error(`Unexpected fs write or mutation method: ${String(property)}`);
      },
    });

    const report = detectAgentInstallations({ homeDir, fs: fsReadOnly, now: 1 });

    assert.strictEqual(byId(report, "opencode").detectedInstalled, true);
  });

  it("detects supported agents from custom discovery paths", () => {
    const homeDir = makeHome();
    const customConfigDir = path.join(homeDir, "custom-codex-config");
    mkdirp(customConfigDir);

    const report = detectAgentInstallations({
      homeDir,
      now: 1,
      snapshot: {
        agents: {
          codex: { customDiscoveryPaths: [customConfigDir] },
        },
      },
    });
    const codex = byId(report, "codex");

    assert.strictEqual(codex.detectedInstalled, true);
    assert.strictEqual(codex.confidence, "medium");
    assert.strictEqual(codex.reason, "custom-path");
    assert.match(codex.detail, /custom-codex-config/);
    assert.match(codex.detail, /User-provided path/);
  });

  it("prefers a custom discovery path over the default parent dir and reports not-found when neither exists", () => {
    const homeDir = makeHome();
    mkdirp(path.join(homeDir, ".codex"));
    const customConfigDir = path.join(homeDir, "custom-codex-config");
    mkdirp(customConfigDir);

    const custom = byId(detectAgentInstallations({
      homeDir,
      now: 1,
      customDiscoveryPaths: { codex: [customConfigDir] },
    }), "codex");
    assert.strictEqual(custom.reason, "custom-path");
    assert.deepStrictEqual(custom.paths.customDiscoveryPaths, [customConfigDir]);

    const missing = byId(detectAgentInstallations({
      homeDir: makeHome(),
      now: 1,
      customDiscoveryPaths: { codex: [path.join(homeDir, "does-not-exist")] },
    }), "codex");
    assert.strictEqual(missing.detectedInstalled, false);
    assert.strictEqual(missing.reason, "not-found");
  });

  it("reports the shared custom tool discovery slot separately", () => {
    const homeDir = makeHome();
    const customExe = path.join(homeDir, "CustomAI.exe");
    writeText(customExe, "");
    fs.chmodSync(customExe, 0o755);

    const report = detectAgentInstallations({
      homeDir,
      now: 1,
      snapshot: {
        customToolDiscoveryPaths: [customExe, path.join(homeDir, "missing")],
      },
    });

    assert.strictEqual(report.customTools.length, 2);
    assert.strictEqual(report.customTools[0].detectedInstalled, true);
    assert.strictEqual(report.customTools[0].confidence, "high");
    assert.strictEqual(report.customTools[0].reason, "application-recognized");
    assert.strictEqual(report.customTools[0].kind, "file");
    assert.strictEqual(report.customTools[0].application.name, "CustomAI");
    assert.strictEqual(report.customTools[0].application.added, false);
    assert.strictEqual(report.customTools[1].detectedInstalled, false);
  });

  it("reports registered custom executables independently from discovery paths", () => {
    const homeDir = makeHome();
    const executablePath = path.join(homeDir, "NovaAI.exe");
    writeText(executablePath, "");
    const application = {
      id: "custom-nova-ai-0123456789ab",
      executablePath,
    };

    const present = detectAgentInstallations({
      homeDir,
      now: 1,
      snapshot: { customApplications: [application], customToolDiscoveryPaths: [] },
    });
    assert.deepStrictEqual(present.customTools, []);
    assert.strictEqual(present.customAgents.length, 1);
    assert.strictEqual(present.customAgents[0].agentId, application.id);
    assert.strictEqual(present.customAgents[0].detectedInstalled, true);

    fs.rmSync(executablePath);
    const missing = detectAgentInstallations({
      homeDir,
      now: 2,
      snapshot: { customApplications: [application], customToolDiscoveryPaths: [] },
    });
    assert.strictEqual(missing.customAgents[0].detectedInstalled, false);
  });

  it("does not infer built-in agent installs from generic Windows app-name guesses", () => {
    const root = makeHome();
    const localAppData = path.join(root, "LocalAppData");
    const executable = path.join(localAppData, "Programs", "Nova AI", "Nova AI.exe");
    writeText(executable, "");
    const descriptor = {
      agentId: "nova-ai",
      agentName: "Nova AI",
      parentDir: path.join(root, ".nova-ai"),
      configPath: path.join(root, ".nova-ai", "settings.json"),
      marker: "duck",
    };
    const result = detectAgentInstallation(descriptor, {
      homeDir: root,
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
    });
    assert.strictEqual(result.detectedInstalled, false);
    assert.strictEqual(result.confidence, "low");
    assert.strictEqual(result.reason, "not-found");
  });
});
