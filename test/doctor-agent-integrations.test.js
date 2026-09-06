const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const {
  checkAgentIntegrations,
  findOpencodePluginEntry,
} = require("../src/shell/doctor-detectors/agent-integrations");
const { getAgentDescriptor } = require("../src/shell/doctor-detectors/agent-descriptors");
const {
  CODEX_WINDOWS_STABLE_ARG,
  buildCodexHookCommand,
  buildStableCodexHookCommand,
  materializeStableCodexHookLauncher,
} = require("../hooks/codex-install-utils");
const {
  computeCodexHookTrustedHash,
  findCodexHookTrustPositions,
} = require("../src/shell/doctor-detectors/codex-features-check");
const { validateHookTarget } = require("../src/shell/doctor-detectors/agent-node-bin-parser");

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-doctor-agent-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function baseDescriptor(overrides = {}) {
  const root = makeTempDir();
  const parentDir = path.join(root, ".agent");
  return {
    agentId: "test-agent",
    agentName: "Test Agent",
    eventSource: "hook",
    parentDir,
    configPath: path.join(parentDir, "settings.json"),
    configMode: "file",
    autoInstall: true,
    marker: "test-hook.js",
    nested: false,
    ...overrides,
  };
}

function runOne(descriptor, options = {}) {
  return checkAgentIntegrations({
    fs,
    platform: options.platform,
    prefs: options.prefs || {},
    descriptors: [descriptor],
    server: options.server || null,
    validateCommand: options.validateCommand || (() => ({
      ok: true,
      nodeBin: "/node",
      scriptPath: "/app/hooks/test-hook.js",
    })),
    validateTarget: options.validateTarget || ((target) => ({
      ok: true,
      nodeBin: target.nodeBin,
      scriptPath: target.scriptPath,
    })),
  }).details[0];
}

function suspiciousShrinkGuardServer() {
  return {
    getClaudeHookGuardStatus: () => ({
      type: "suspicious-shrink",
      at: 1234,
      before: { keyCount: 5, hookCount: 12, thirdPartyHookCount: 2 },
      after: { keyCount: 1, hookCount: 0, thirdPartyHookCount: 0 },
    }),
  };
}

function managedFileDescriptor(agentId, dirName) {
  const root = makeTempDir();
  const parentDir = path.join(root, dirName);
  return {
    ...getAgentDescriptor(agentId),
    parentDir,
    configPath: path.join(parentDir, "settings.json"),
  };
}

// Codex hooks.json nests each event's command under hooks.<Event>[].hooks[]
// (descriptor.nested), with config.toml as the supplementary feature gate.
function codexDescriptor() {
  const root = makeTempDir();
  const parentDir = path.join(root, ".codex");
  return baseDescriptor({
    agentId: "codex",
    marker: "codex-hook.js",
    parentDir,
    configPath: path.join(parentDir, "hooks.json"),
    nested: true,
    supplementary: {
      key: "hooks",
      configPath: path.join(parentDir, "config.toml"),
    },
  });
}

function codexHooksConfig(events) {
  const hooks = {};
  for (const event of events) {
    hooks[event] = [{ hooks: [{
      type: "command",
      command: `"/node" "/app/hooks/codex-hook.js" ${event}`,
      timeout: event === "PermissionRequest" ? 600 : 30,
    }] }];
  }
  return { hooks };
}

function codexTrustState(descriptor, settings, platform = process.platform) {
  const positions = findCodexHookTrustPositions(settings);
  return [
    "[features]",
    "hooks = true",
    "",
    ...positions.flatMap((position) => [
      `[hooks.state.'${descriptor.configPath}:${position.eventKey}:${position.entryIndex}:${position.hookIndex}']`,
      `trusted_hash = "${computeCodexHookTrustedHash(
        position.eventName,
        position.group,
        position.hook,
        platform
      )}"`,
      "",
    ]),
  ].join("\n");
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("checkAgentIntegrations", () => {
  it("returns not-installed when parent dir is missing", () => {
    const detail = runOne(baseDescriptor());
    assert.strictEqual(detail.status, "not-installed");
    assert.strictEqual(detail.level, "info");
    assert.strictEqual(detail.parentDirExists, false);
  });

  it("reports not-managed before disabled for uninstalled agents", () => {
    const descriptor = baseDescriptor({ agentId: "opencode" });
    const detail = runOne(descriptor, {
      prefs: {
        agents: {
          opencode: {
            integrationInstalled: false,
            enabled: false,
          },
        },
      },
    });

    assert.strictEqual(detail.status, "not-managed");
    assert.strictEqual(detail.level, "info");
  });

  it("keeps an enabled but missing install info-only when another integration is ok", () => {
    const okDescriptor = baseDescriptor({
      agentId: "ok-agent",
      marker: "ok-hook.js",
    });
    writeJson(okDescriptor.configPath, {
      hooks: {
        Stop: [{ command: '"/node" "/app/hooks/ok-hook.js" Stop' }],
      },
    });
    const missingDescriptor = baseDescriptor({
      agentId: "opencode",
      marker: "opencode-plugin",
    });

    const result = checkAgentIntegrations({
      fs,
      prefs: { agents: { opencode: { enabled: true } } },
      descriptors: [okDescriptor, missingDescriptor],
      validateCommand: () => ({
        ok: true,
        nodeBin: "/node",
        scriptPath: "/app/hooks/ok-hook.js",
      }),
    });

    const missing = result.details.find((detail) => detail.agentId === "opencode");
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(missing.status, "not-installed");
    assert.strictEqual(missing.level, "info");
  });

  it("returns not-connected when config is missing for an auto-installed agent", () => {
    const descriptor = baseDescriptor();
    fs.mkdirSync(descriptor.parentDir, { recursive: true });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-connected");
    assert.strictEqual(detail.level, "warning");
    assert.strictEqual(detail.configFileExists, false);
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "test-agent" });
  });

  it("explains Claude hook loss when the suspicious-shrink guard recently fired", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: suspiciousShrinkGuardServer(),
    });

    assert.strictEqual(detail.status, "not-connected");
    assert.match(detail.detail, /paused automatic Claude hook repair/);
    assert.strictEqual(detail.claudeHookGuard.type, "suspicious-shrink");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "claude-code" });
  });

  it("does not show the Claude guard notice for other agents", () => {
    const descriptor = baseDescriptor();
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: suspiciousShrinkGuardServer(),
    });

    assert.strictEqual(detail.status, "not-connected");
    assert.match(detail.detail, /has no test-hook\.js command/);
    assert.doesNotMatch(detail.detail, /paused automatic Claude hook repair/);
    assert.strictEqual(detail.claudeHookGuard, undefined);
  });

  it("does not show the Claude guard notice when Claude hooks are connected", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [{
          matcher: "",
          hooks: [{ command: '"/node" "/app/hooks/duck-hook.js" Stop' }],
        }],
      },
    });

    const detail = runOne(descriptor, {
      server: suspiciousShrinkGuardServer(),
    });

    assert.strictEqual(detail.status, "ok");
    assert.doesNotMatch(detail.detail, /paused automatic Claude hook repair/);
    assert.strictEqual(detail.claudeHookGuard, undefined);
  });

  it("keeps the original Claude hook loss detail when no guard status is available", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: {},
    });

    assert.strictEqual(detail.status, "not-connected");
    assert.match(detail.detail, /has no duck-hook\.js command/);
    assert.doesNotMatch(detail.detail, /paused automatic Claude hook repair/);
    assert.strictEqual(detail.claudeHookGuard, undefined);
  });

  it("reports source-script-missing without a configuration Repair when the runtime health says the source is gone", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({
          status: "degraded",
          degradedReason: "source-script-missing",
          at: 5000,
        }),
      },
    });

    assert.strictEqual(detail.status, "source-script-missing");
    assert.match(detail.detail, /reinstall or re-extract/i);
    assert.strictEqual(detail.claudeHookRuntimeStatus.degradedReason, "source-script-missing");
    assert.strictEqual(detail.fixAction, undefined, "source-script-missing must not offer a configuration Repair");
  });

  it("explains when an env-indirected Claude hook is preserved because Node is unresolved (#852)", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({
          status: "degraded",
          degradedReason: "env-hook-node-unresolved",
          at: 7000,
        }),
      },
    });

    assert.strictEqual(detail.status, "not-connected");
    assert.match(detail.detail, /DUCK_NODE_BIN/);
    assert.strictEqual(detail.claudeHookRuntimeStatus.degradedReason, "env-hook-node-unresolved");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "claude-code" });
  });

  it("keeps an unverified env-indirected hook visible beside an otherwise valid Claude hook (#852)", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [
          { matcher: "", hooks: [{ type: "command", command: '"node" "/app/hooks/duck-hook.js" Stop' }] },
          { matcher: "", hooks: [{ type: "command", command: '"${DUCK_NODE_BIN}" "${DUCK_HOOK_PATH}" Stop' }] },
        ],
      },
    });

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({
          status: "degraded",
          degradedReason: "env-indirection-unverified",
          at: 8000,
        }),
      },
    });

    assert.strictEqual(detail.status, "needs-review", "generic marker success must not hide the degraded env diagnostic");
    assert.strictEqual(detail.level, "warning");
    assert.match(detail.detail, /DUCK_HOOK_PATH/);
    assert.strictEqual(detail.claudeHookRuntimeStatus.degradedReason, "env-indirection-unverified");
    assert.strictEqual(detail.fixAction, undefined, "unverified ownership must not offer a destructive automatic Fix");
  });

  it("does not let a stale env runtime diagnostic hide a corrupt Claude settings file (#852)", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeText(descriptor.configPath, "{not-json");

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({
          status: "degraded",
          degradedReason: "env-indirection-unverified",
          at: 8100,
        }),
      },
    });

    assert.strictEqual(detail.status, "config-corrupt");
    assert.match(detail.detail, /parse|JSON|corrupt/i);
    assert.strictEqual(detail.claudeHookRuntimeStatus, undefined);
  });

  it("explains manual-fix-required while still offering an explicit Fix that can bypass the automatic cap", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({
          status: "manual-fix-required",
          issueSignature: "v1:core-script-path",
          attempt: 3,
          message: "Claude hook repair did not verify healthy",
          at: 9000,
        }),
      },
    });

    assert.strictEqual(detail.status, "not-connected");
    assert.match(detail.detail, /failed 3 times/);
    assert.strictEqual(detail.claudeHookRuntimeStatus.status, "manual-fix-required");
    assert.strictEqual(detail.claudeHookRuntimeStatus.issueSignature, "v1:core-script-path");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "claude-code" });
  });

  it("explains a guarded state reported only through getClaudeHookHealthStatus (no legacy guard notice)", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, { hooks: {} });

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({ status: "guarded", issueSignature: "v1:managed-hooks", at: 3000 }),
      },
    });

    assert.strictEqual(detail.status, "not-connected");
    assert.match(detail.detail, /paused automatic Claude hook repair/);
    assert.strictEqual(detail.claudeHookRuntimeStatus.status, "guarded");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "claude-code" });
  });

  it("does not annotate a healthy disk state even if a stale runtime notice exists", () => {
    const descriptor = baseDescriptor({
      agentId: "claude-code",
      agentName: "Claude Code",
      marker: "duck-hook.js",
      nested: true,
    });
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [{ matcher: "", hooks: [{ command: '"/node" "/app/hooks/duck-hook.js" Stop' }] }],
      },
    });

    const detail = runOne(descriptor, {
      server: {
        getClaudeHookHealthStatus: () => ({ status: "manual-fix-required", issueSignature: "v1:core-script-path", at: 1000 }),
      },
    });

    assert.strictEqual(detail.status, "ok");
    assert.strictEqual(detail.claudeHookRuntimeStatus, undefined);
  });

  it("returns config-corrupt when JSON parsing fails", () => {
    const descriptor = baseDescriptor();
    fs.mkdirSync(descriptor.parentDir, { recursive: true });
    fs.writeFileSync(descriptor.configPath, "{ nope", "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "config-corrupt");
    assert.strictEqual(detail.level, "warning");
    assert.strictEqual(detail.fixAction, undefined);
  });

  it("validates flat hook commands and marks ok", () => {
    const descriptor = baseDescriptor();
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [{ command: '"/node" "/app/hooks/test-hook.js"' }],
      },
    });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok");
    assert.strictEqual(detail.commandCount, 1);
  });

  it("validates nested hook commands when descriptor requests nested mode", () => {
    const descriptor = baseDescriptor({ nested: true });
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [{
          hooks: [{ command: '"/node" "/app/hooks/test-hook.js"' }],
        }],
      },
    });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok");
  });

  it("returns broken-path when all matching commands fail validation", () => {
    const descriptor = baseDescriptor();
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [{ command: '"/node" "/missing/test-hook.js"' }],
      },
    });

    const detail = runOne(descriptor, {
      validateCommand: () => ({
        ok: false,
        issue: "scriptPath-missing",
        nodeBin: "/node",
        scriptPath: "/missing/test-hook.js",
      }),
    });
    assert.strictEqual(detail.status, "broken-path");
    assert.strictEqual(detail.hookCommandIssue, "scriptPath-missing");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "test-agent" });
  });

  it("lists every multi-home parent dir when none exists", () => {
    const root = makeTempDir();
    const legacyDir = path.join(root, ".codex");
    const currentDir = path.join(root, ".codex-next");
    const descriptor = baseDescriptor({
      agentId: "codex",
      marker: "codex-hook.js",
      parentDir: legacyDir,
      configPath: path.join(legacyDir, "hooks.json"),
      configTargets: [
        { label: "current", parentDir: currentDir, configPath: path.join(currentDir, "hooks.json") },
        { label: "legacy", parentDir: legacyDir, configPath: path.join(legacyDir, "hooks.json") },
      ],
    });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-installed");
    assert.ok(detail.detail.includes(".codex-next") && detail.detail.includes(".codex"));
  });

  it("turns Codex ok into warning when hooks=false", () => {
    const descriptor = codexDescriptor();
    writeJson(descriptor.configPath, codexHooksConfig(["Stop"]));
    fs.writeFileSync(descriptor.supplementary.configPath, "[features]\nhooks = false\n", "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-connected");
    assert.strictEqual(detail.supplementary.value, "disabled");
    assert.deepStrictEqual(detail.fixAction, {
      type: "agent-integration",
      agentId: "codex",
      forceCodexHooksFeature: true,
    });
  });


  // #544: Windows Duck writes dual-field entries — commandWindows carries
  // the PowerShell form codex actually runs on Windows, command carries a
  // WSL-interop form only executable inside WSL. The doctor must validate
  // the field THIS platform's codex resolves; blanket-validating `command`
  // flagged every dual-field Windows install as broken-path, and Repair
  // regenerated the same fields forever.
  it("validates commandWindows on win32 for dual-field Codex entries (#544)", () => {
    const descriptor = codexDescriptor();
    const psForm = '& "C:\\Program Files\\nodejs\\node.exe" "D:/app/hooks/codex-hook.js"';
    const interopForm = '"/mnt/c/Program Files/nodejs/node.exe" "D:/app/hooks/codex-hook.js"';
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: interopForm, commandWindows: psForm, timeout: 30 }] }],
      },
    };
    writeJson(descriptor.configPath, settings);
    fs.writeFileSync(descriptor.supplementary.configPath, codexTrustState(descriptor, settings, "win32"), "utf8");

    const seen = [];
    const result = checkAgentIntegrations({
      fs,
      prefs: {},
      descriptors: [descriptor],
      server: null,
      platform: "win32",
      validateCommand: (command) => {
        seen.push(command);
        return {
          ok: true,
          nodeBin: "C:\\Program Files\\nodejs\\node.exe",
          scriptPath: "D:/app/hooks/codex-hook.js",
        };
      },
    });

    assert.deepStrictEqual(seen, [psForm]);
    assert.strictEqual(result.details[0].status, "ok");
  });

  it("validates the POSIX command field for dual-field Codex entries off win32", () => {
    const descriptor = codexDescriptor();
    const psForm = '& "C:\\Program Files\\nodejs\\node.exe" "D:/app/hooks/codex-hook.js"';
    const interopForm = '"/mnt/c/Program Files/nodejs/node.exe" "D:/app/hooks/codex-hook.js"';
    const settings = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: interopForm, commandWindows: psForm, timeout: 30 }] }],
      },
    };
    writeJson(descriptor.configPath, settings);
    fs.writeFileSync(descriptor.supplementary.configPath, codexTrustState(descriptor, settings, "linux"), "utf8");

    const seen = [];
    const result = checkAgentIntegrations({
      fs,
      prefs: {},
      descriptors: [descriptor],
      server: null,
      platform: "linux",
      validateCommand: (command) => {
        seen.push(command);
        return { ok: true, nodeBin: "/mnt/c/Program Files/nodejs/node.exe", scriptPath: "D:/app/hooks/codex-hook.js" };
      },
    });

    assert.deepStrictEqual(seen, [interopForm]);
    assert.strictEqual(result.details[0].status, "ok");
  });

  it("reports a corrupt Codex stable-launcher manifest as repairable", () => {
    const descriptor = codexDescriptor();
    const target = path.join(descriptor.parentDir, "source", "codex-hook.js");
    writeText(target, "process.stdout.write('{}');\n");
    const stable = materializeStableCodexHookLauncher(target, {
      codexDir: descriptor.parentDir,
      nodeBin: process.execPath,
      platform: process.platform,
    });
    const command = buildStableCodexHookCommand(stable.launcherPath, process.platform);
    const settings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command, timeout: 30 }] }] },
    };
    writeJson(descriptor.configPath, settings);
    fs.writeFileSync(
      descriptor.supplementary.configPath,
      codexTrustState(descriptor, settings, process.platform),
      "utf8"
    );
    fs.writeFileSync(stable.manifestPath, "{ corrupt", "utf8");

    const detail = runOne(descriptor, {
      platform: process.platform,
      validateTarget: validateHookTarget,
    });

    assert.strictEqual(detail.status, "broken-path");
    assert.strictEqual(detail.hookCommandIssue, "stable-manifest-invalid");
    assert.strictEqual(detail.scriptPath, stable.launcherPath);
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "codex" });
  });

  it("validates managed Windows sidecar integrity behind a direct command", () => {
    const descriptor = codexDescriptor();
    const target = path.join(descriptor.parentDir, "source", "codex-hook.js");
    writeText(target, "process.stdout.write('{}');\n");
    const stable = materializeStableCodexHookLauncher(target, {
      codexDir: descriptor.parentDir,
      nodeBin: process.execPath,
      platform: "win32",
    });
    const commandWindows = `${buildCodexHookCommand(
      stable.nodeBin,
      stable.target,
      "win32"
    )} ${CODEX_WINDOWS_STABLE_ARG}`;
    const settings = {
      hooks: {
        Stop: [{ hooks: [{
          type: "command",
          command: '"node.exe" "/mnt/c/app/hooks/codex-hook.js" --duck-wsl-interop',
          commandWindows,
          timeout: 30,
        }] }],
      },
    };
    writeJson(descriptor.configPath, settings);
    fs.writeFileSync(
      descriptor.supplementary.configPath,
      codexTrustState(descriptor, settings, "win32"),
      "utf8"
    );

    const healthy = runOne(descriptor, {
      platform: "win32",
      validateTarget: (candidate) => ({ ok: true, ...candidate }),
    });
    assert.strictEqual(healthy.status, "ok");
    assert.match(healthy.detail, /stable execution target verified/);

    fs.writeFileSync(stable.windowsRunPath, "corrupt-sidecar\n", "utf8");
    const damaged = runOne(descriptor, {
      platform: "win32",
      validateTarget: (candidate) => ({ ok: true, ...candidate }),
    });
    assert.strictEqual(damaged.status, "broken-path");
    assert.strictEqual(damaged.hookCommandIssue, "stable-launcher-invalid");
    assert.deepStrictEqual(damaged.fixAction, { type: "agent-integration", agentId: "codex" });
  });

  it("reports a missing Codex stable-launcher target as repairable", () => {
    const descriptor = codexDescriptor();
    const target = path.join(descriptor.parentDir, "source", "codex-hook.js");
    writeText(target, "process.stdout.write('{}');\n");
    const stable = materializeStableCodexHookLauncher(target, {
      codexDir: descriptor.parentDir,
      nodeBin: process.execPath,
      platform: process.platform,
    });
    const command = buildStableCodexHookCommand(stable.launcherPath, process.platform);
    const settings = {
      hooks: { Stop: [{ hooks: [{ type: "command", command, timeout: 30 }] }] },
    };
    writeJson(descriptor.configPath, settings);
    fs.writeFileSync(
      descriptor.supplementary.configPath,
      codexTrustState(descriptor, settings, process.platform),
      "utf8"
    );
    fs.unlinkSync(target);

    const detail = runOne(descriptor, {
      platform: process.platform,
      validateTarget: validateHookTarget,
    });

    assert.strictEqual(detail.status, "broken-path");
    assert.strictEqual(detail.hookCommandIssue, "scriptPath-missing");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "codex" });
  });

  it("reports Codex hooks=false even when hook registration is missing", () => {
    const descriptor = codexDescriptor();
    writeJson(descriptor.configPath, { hooks: {} });
    fs.writeFileSync(descriptor.supplementary.configPath, "[features]\nhooks = false\n", "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-connected");
    assert.strictEqual(detail.level, "warning");
    assert.deepStrictEqual(detail.supplementary, {
      key: "hooks",
      value: "disabled",
      detail: "hooks=false",
    });
    assert.deepStrictEqual(detail.fixAction, {
      type: "agent-integration",
      agentId: "codex",
      forceCodexHooksFeature: true,
    });
  });
  it("turns Codex ok into warning when hooks need Codex review", () => {
    const descriptor = codexDescriptor();
    writeJson(descriptor.configPath, codexHooksConfig(["PermissionRequest", "Stop"]));
    fs.writeFileSync(descriptor.supplementary.configPath, "[features]\nhooks = true\n", "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "needs-review");
    assert.strictEqual(detail.level, "warning");
    assert.strictEqual(detail.fixAction, undefined);
    assert.deepStrictEqual(detail.supplementary, {
      key: "hooks",
      value: "enabled",
      detail: "hooks=true",
    });
    assert.strictEqual(detail.codexHookTrust.value, "needs-review");
    assert.strictEqual(detail.codexHookTrust.totalCount, 2);
    assert.deepStrictEqual(detail.codexHookTrust.missingEvents, ["PermissionRequest", "Stop"]);
    assert.match(detail.codexHookTrust.detail, /Codex \/hooks review/);
  });

  it("keeps Codex ok when Codex hook trust state exists", () => {
    const descriptor = codexDescriptor();
    const events = ["PermissionRequest", "Stop"];
    const settings = codexHooksConfig(events);
    writeJson(descriptor.configPath, settings);
    fs.writeFileSync(descriptor.supplementary.configPath, codexTrustState(descriptor, settings), "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok");
    assert.strictEqual(detail.level, null);
    assert.strictEqual(detail.fixAction, undefined);
    assert.strictEqual(detail.codexHookTrust.value, "trusted");
    assert.strictEqual(detail.codexHookTrust.trustedCount, 2);
  });

  function piDescriptor() {
    const root = makeTempDir();
    const parentDir = path.join(root, ".pi", "agent");
    return baseDescriptor({
      agentId: "pi",
      agentName: "Pi",
      eventSource: "extension",
      parentDir,
      configPath: path.join(parentDir, "extensions", "duck-on-desk"),
      configMode: "pi-extension",
      marker: "index.ts",
      coreFile: "pi-extension-core.js",
      markerFile: ".duck-on-desk-managed.json",
    });
  }

  it("reports missing Pi extension as repairable not-connected", () => {
    const descriptor = piDescriptor();
    fs.mkdirSync(descriptor.parentDir, { recursive: true });

    const detail = runOne(descriptor);

    assert.strictEqual(detail.status, "not-connected");
    assert.strictEqual(detail.eventSource, "extension");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "pi" });
  });

  it("reports unmanaged Pi extension directory as needs-review without repair action", () => {
    const descriptor = piDescriptor();
    fs.mkdirSync(descriptor.configPath, { recursive: true });
    fs.writeFileSync(path.join(descriptor.configPath, "index.ts"), "export default function() {}\n", "utf8");

    const detail = runOne(descriptor);

    assert.strictEqual(detail.status, "needs-review");
    assert.strictEqual(detail.level, "warning");
    assert.strictEqual(detail.fixAction, undefined);
  });

  it("reports managed Pi extension as ok", () => {
    const descriptor = piDescriptor();
    writeJson(path.join(descriptor.configPath, ".duck-on-desk-managed.json"), {
      app: "duck-on-desk",
      integration: "pi",
      managed: true,
    });
    fs.writeFileSync(path.join(descriptor.configPath, "index.ts"), "export default function() {}\n", "utf8");
    fs.writeFileSync(path.join(descriptor.configPath, "pi-extension-core.js"), "module.exports = {}\n", "utf8");

    const detail = runOne(descriptor);

    assert.strictEqual(detail.status, "ok");
    assert.strictEqual(detail.extensionFileExists, true);
    assert.strictEqual(detail.coreFileExists, true);
  });

  it("reports managed Pi extension with missing copied files as repairable broken-path", () => {
    const descriptor = piDescriptor();
    writeJson(path.join(descriptor.configPath, ".duck-on-desk-managed.json"), {
      app: "duck-on-desk",
      integration: "pi",
      managed: true,
    });
    fs.writeFileSync(path.join(descriptor.configPath, "index.ts"), "export default function() {}\n", "utf8");

    const detail = runOne(descriptor);

    assert.strictEqual(detail.status, "broken-path");
    assert.strictEqual(detail.coreFileExists, false);
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "pi" });
  });

  it("reports opencode stale absolute plugin paths", () => {
    const root = makeTempDir();
    const parentDir = path.join(root, ".config", "opencode");
    const pluginPath = path.join(root, "missing", "opencode-plugin");
    const descriptor = baseDescriptor({
      agentId: "opencode",
      marker: "opencode-plugin",
      parentDir,
      configPath: path.join(parentDir, "opencode.json"),
      detection: "opencode-plugin",
    });
    writeJson(descriptor.configPath, { plugin: [pluginPath] });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "broken-path");
    assert.strictEqual(detail.opencodeEntryIssue, "directory-missing");
    assert.deepStrictEqual(detail.fixAction, { type: "agent-integration", agentId: "opencode" });
  });

  it("surfaces WHICH shared family file is missing in the broken-path detail", () => {
    const root = makeTempDir();
    const parentDir = path.join(root, ".config", "opencode");
    const hooksDir = path.join(root, "hooks");
    const pluginPath = path.join(hooksDir, "opencode-plugin");
    const familyDir = path.join(hooksDir, "opencode-family-plugin");
    // Entry + core present, session-ids MISSING — the packaging false-green
    // scenario the two-level closure check exists for (plan §3.4).
    fs.mkdirSync(pluginPath, { recursive: true });
    fs.writeFileSync(path.join(pluginPath, "index.mjs"), "export default async () => ({});\n", "utf8");
    fs.mkdirSync(familyDir, { recursive: true });
    fs.writeFileSync(path.join(familyDir, "core.mjs"), "export function createOpencodeFamilyPlugin() {}\n", "utf8");

    const descriptor = baseDescriptor({
      agentId: "opencode",
      marker: "opencode-plugin",
      parentDir,
      configPath: path.join(parentDir, "opencode.json"),
      detection: "opencode-plugin",
    });
    writeJson(descriptor.configPath, { plugin: [pluginPath] });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "broken-path");
    assert.strictEqual(detail.opencodeEntryIssue, "family-core-missing");
    // The modal renders detail verbatim (no i18n layer) — the user must see
    // a readable phrase AND the concrete missing path, not the raw key.
    assert.match(detail.detail, /shared opencode-family file/);
    assert.ok(
      detail.detail.includes(path.join(familyDir, "session-ids.mjs")),
      `detail should name the missing file: ${detail.detail}`
    );
  });

  function makeValidFamilyPlugin(root, pluginDirName) {
    const hooksDir = path.join(root, "hooks");
    const pluginPath = path.join(hooksDir, pluginDirName);
    const familyDir = path.join(hooksDir, "opencode-family-plugin");
    fs.mkdirSync(pluginPath, { recursive: true });
    fs.writeFileSync(path.join(pluginPath, "index.mjs"), "export default async () => ({});\n", "utf8");
    fs.mkdirSync(familyDir, { recursive: true });
    fs.writeFileSync(path.join(familyDir, "core.mjs"), "export function createOpencodeFamilyPlugin() {}\n", "utf8");
    fs.writeFileSync(path.join(familyDir, "session-ids.mjs"), "export function createSessionIdHelpers() {}\n", "utf8");
    return pluginPath;
  }

  function jsoncDescriptor(root, overrides = {}) {
    const parentDir = path.join(root, ".config", "opencode");
    fs.mkdirSync(parentDir, { recursive: true });
    return baseDescriptor({
      agentId: "opencode",
      marker: "opencode-plugin",
      parentDir,
      configPath: path.join(parentDir, "opencode.jsonc"),
      detection: "opencode-plugin",
      configJsonc: true,
      ...overrides,
    });
  }

  it("parses a jsonc: true family config (comments + trailing commas) as healthy, not config-corrupt", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = jsoncDescriptor(root);
    fs.writeFileSync(
      descriptor.configPath,
      `{\n  // Duck pet plugin\n  "plugin": [\n    ${JSON.stringify(pluginPath)},\n  ],\n}\n`,
      "utf8"
    );

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok", `expected ok, got ${detail.status}: ${detail.detail}`);
  });

  it("still reports genuinely corrupt family JSONC as config-corrupt", () => {
    const root = makeTempDir();
    const descriptor = jsoncDescriptor(root);
    fs.writeFileSync(descriptor.configPath, '{\n  "plugin": [\n', "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "config-corrupt");
    assert.match(detail.detail, /invalid JSONC/);
  });

  it("routes ONLY configJsonc descriptors through the JSONC parser", () => {
    // Without the flag, the same commented config must fail JSON.parse — this
    // locks the routing to the descriptor flag rather than a blanket parser
    // swap (opencode.json stays strict JSON).
    const root = makeTempDir();
    const descriptor = jsoncDescriptor(root, { configJsonc: undefined });
    fs.writeFileSync(descriptor.configPath, '{\n  // comment\n  "plugin": [],\n}\n', "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "config-corrupt");
  });

  function mergedJsoncDescriptor(root, overrides = {}) {
    const parentDir = path.join(root, ".config", "opencode");
    return jsoncDescriptor(root, {
      configCandidates: ["opencode.jsonc", "opencode.json", "config.json"].map((name) => path.join(parentDir, name)),
      ...overrides,
    });
  }

  it("merged view: validates the live plugin owner (.json) when .jsonc exists without plugin", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = mergedJsoncDescriptor(root);
    fs.writeFileSync(path.join(path.dirname(descriptor.configPath), "opencode.json"), JSON.stringify({ plugin: [pluginPath] }), "utf8");
    fs.writeFileSync(descriptor.configPath, '{\n  // prefs only\n  "model": "anthropic/claude-sonnet-4-6",\n}\n', "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok", `expected ok, got ${detail.status}: ${detail.detail}`);
    assert.ok(detail.configPath.endsWith("opencode.json"), "detail must point at the file whose plugin is live");
  });

  it("merged view: a managed entry MASKED by a higher-priority plugin array is not connected", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = mergedJsoncDescriptor(root);
    // .jsonc declares plugin (empty) → it REPLACES .json's array at runtime,
    // so the valid entry in .json is dead. The doctor must see the merge.
    fs.writeFileSync(descriptor.configPath, '{\n  "plugin": [],\n}\n', "utf8");
    fs.writeFileSync(path.join(path.dirname(descriptor.configPath), "opencode.json"), JSON.stringify({ plugin: [pluginPath] }), "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-connected", `masked entry must not count: ${detail.detail}`);
  });

  it("merged view: no candidate exists → not-connected missing", () => {
    const root = makeTempDir();
    const descriptor = mergedJsoncDescriptor(root);
    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-connected");
    assert.strictEqual(detail.configFileExists, false);
  });

  it("merged view: a corrupt candidate is config-corrupt and names the file", () => {
    const root = makeTempDir();
    const descriptor = mergedJsoncDescriptor(root);
    fs.writeFileSync(descriptor.configPath, '{\n  "plugin": [],\n}\n', "utf8");
    fs.writeFileSync(path.join(path.dirname(descriptor.configPath), "opencode.json"), "{ broken", "utf8");

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "config-corrupt");
    assert.ok(detail.detail.includes("opencode.json"), `detail must name the corrupt file: ${detail.detail}`);
  });

  // #825: opencode's global config is a MERGE of config.json → opencode.json →
  // opencode.jsonc (later wins, "plugin" arrays REPLACED). The doctor must
  // validate the MERGED effective view — reading opencode.json alone reported
  // "plugin entry verified" while opencode was actually running the .jsonc
  // array with no Duck plugin in it.
  function opencodeDescriptor(root, overrides = {}) {
    const parentDir = path.join(root, ".config", "opencode");
    fs.mkdirSync(parentDir, { recursive: true });
    return baseDescriptor({
      agentId: "opencode",
      marker: "opencode-plugin",
      parentDir,
      configPath: path.join(parentDir, "opencode.json"),
      detection: "opencode-plugin",
      configJsonc: true,
      configCandidates: ["opencode.jsonc", "opencode.json", "config.json"].map((n) => path.join(parentDir, n)),
      ...overrides,
    });
  }

  it("#825: reports NOT connected when opencode.jsonc masks a plugin entry in opencode.json", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = opencodeDescriptor(root);
    const dir = descriptor.parentDir;
    writeJson(path.join(dir, "opencode.json"), { plugin: [pluginPath] });
    writeText(path.join(dir, "opencode.jsonc"), '{\n  // the file opencode runs\n  "plugin": ["@vendor/other"],\n}\n');

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "not-connected", `expected not-connected, got ${detail.status}: ${detail.detail}`);
    assert.ok(
      detail.detail.includes("opencode.jsonc"),
      `detail must name the file opencode actually reads, got: ${detail.detail}`
    );
  });

  it("#825: reports ok when the plugin entry lives in the winning opencode.jsonc", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = opencodeDescriptor(root);
    const dir = descriptor.parentDir;
    writeJson(path.join(dir, "opencode.json"), { plugin: ["@vendor/other"] });
    writeText(path.join(dir, "opencode.jsonc"), `{\n  // live\n  "plugin": [${JSON.stringify(pluginPath)}],\n}\n`);

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok", `expected ok, got ${detail.status}: ${detail.detail}`);
    assert.ok(detail.detail.includes("opencode.jsonc"));
  });

  it("#825: honors opencode.json when a higher-priority opencode.jsonc declares NO plugin key", () => {
    // The discriminating case: .jsonc is the highest-priority EXISTING file but
    // does not declare "plugin", so opencode still runs .json's array. Picking
    // "first existing" instead of "first that declares plugin" would report a
    // healthy install as not-connected.
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = opencodeDescriptor(root);
    const dir = descriptor.parentDir;
    writeJson(path.join(dir, "opencode.json"), { plugin: [pluginPath] });
    writeText(path.join(dir, "opencode.jsonc"), '{\n  // model prefs only — no plugin key\n  "model": "anthropic/claude-sonnet-4-6",\n}\n');

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok", `expected ok, got ${detail.status}: ${detail.detail}`);
    assert.ok(
      detail.detail.includes("opencode.json") && !detail.detail.includes("opencode.jsonc"),
      `detail must name the live owner opencode.json, got: ${detail.detail}`
    );
  });

  it("#825: single opencode.json installs keep reporting ok (no regression)", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = opencodeDescriptor(root);
    writeJson(path.join(descriptor.parentDir, "opencode.json"), { plugin: [pluginPath] });

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok", `expected ok, got ${detail.status}: ${detail.detail}`);
    assert.ok(detail.detail.includes("opencode.json"));
  });

  it("#825: a commented opencode.json is healthy, not config-corrupt", () => {
    const root = makeTempDir();
    const pluginPath = makeValidFamilyPlugin(root, "opencode-plugin");
    const descriptor = opencodeDescriptor(root);
    writeText(
      path.join(descriptor.parentDir, "opencode.json"),
      `{\n  // opencode parses .json with a JSONC reader too\n  "plugin": [${JSON.stringify(pluginPath)}],\n}\n`
    );

    const detail = runOne(descriptor);
    assert.strictEqual(detail.status, "ok", `expected ok, got ${detail.status}: ${detail.detail}`);
  });

  it("descriptor configJsonc matches the family registry's jsonc flag (drift lock)", () => {
    // eslint-disable-next-line global-require
    const { AGENT_DESCRIPTORS } = require("../src/shell/doctor-detectors/agent-descriptors");
    // eslint-disable-next-line global-require
    const { OPENCODE_FAMILY } = require("../agents/opencode-family");
    for (const [agentId, cfg] of Object.entries(OPENCODE_FAMILY)) {
      const descriptor = AGENT_DESCRIPTORS.find((d) => d.agentId === agentId);
      assert.ok(descriptor, `family member ${agentId} must have a doctor descriptor`);
      assert.strictEqual(
        !!descriptor.configJsonc,
        !!cfg.jsonc,
        `${agentId}: doctor descriptor configJsonc must mirror the registry's jsonc flag`
      );
      assert.ok(
        descriptor.configPath.endsWith(cfg.configFileName),
        `${agentId}: descriptor configPath must target ${cfg.configFileName}`
      );
      if (cfg.configCandidates) {
        assert.deepStrictEqual(
          (descriptor.configCandidates || []).map((p) => path.basename(p)),
          [...cfg.configCandidates],
          `${agentId}: descriptor configCandidates must mirror the registry (order matters — highest priority first)`
        );
      }
      // marker feeds the plugin-entry basename match; detection routes into
      // the family validator — a drift in either silently breaks the doctor
      // for a healthy install (R8 P2).
      assert.strictEqual(
        descriptor.marker,
        cfg.pluginDirName,
        `${agentId}: descriptor marker must equal the registry pluginDirName`
      );
      assert.strictEqual(
        descriptor.detection,
        "opencode-plugin",
        `${agentId}: family members must route through the opencode-plugin validator`
      );
    }
  });

  it("adds a non-failing note when per-agent permission bubbles are disabled", () => {
    const descriptor = baseDescriptor({ agentId: "codex", marker: "codex-hook.js" });
    writeJson(descriptor.configPath, {
      hooks: {
        Stop: [{ command: '"/node" "/app/hooks/codex-hook.js"' }],
      },
    });

    const detail = runOne(descriptor, {
      prefs: { agents: { codex: { enabled: true, permissionsEnabled: false } } },
    });
    assert.strictEqual(detail.status, "ok");
    assert.strictEqual(detail.permissionsEnabled, false);
    assert.strictEqual(detail.permissionBubbleDetail, "permission bubbles disabled for this agent");
  });

  it("aggregates all-info states as pass (no false critical) when nothing is active", () => {
    // none-global agents (info status `manual-only`) + missing agents only.
    // Every integration being disabled / manual / not installed is a user or
    // environment choice, not a fault, so the summary must stay green (#490).
    const result = checkAgentIntegrations({
      fs,
      descriptors: [
        baseDescriptor({ agentId: "hypothetical-none-global", configMode: "none-global" }),
        baseDescriptor({ agentId: "missing-agent" }),
      ],
    });
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.level, null);
  });

  it("stays warning when a real problem coexists with info-only integrations", () => {
    // One auto-install agent with a missing config (not-connected → warning)
    // plus a disabled agent (info). The warning must still drive the summary;
    // the #490 de-escalation only applies when nothing is actually wrong.
    const brokenDescriptor = baseDescriptor({ agentId: "broken-agent", marker: "broken-hook.js" });
    fs.mkdirSync(brokenDescriptor.parentDir, { recursive: true });
    const disabledDescriptor = baseDescriptor({ agentId: "off-agent", marker: "off-hook.js" });

    const result = checkAgentIntegrations({
      fs,
      prefs: { agents: { "off-agent": { enabled: false } } },
      descriptors: [brokenDescriptor, disabledDescriptor],
    });

    assert.strictEqual(result.status, "warning");
    assert.strictEqual(result.level, "warning");
    assert.strictEqual(result.warningCount, 1);
    assert.strictEqual(result.okCount, 0);
  });

});

describe("findOpencodePluginEntry", () => {
  it("matches only absolute plugin entries by basename", () => {
    const absEntry = "C:\\duck\\hooks\\opencode-plugin";
    assert.strictEqual(
      findOpencodePluginEntry(["vendor/opencode-plugin", absEntry], "opencode-plugin"),
      absEntry
    );
  });

  it("ignores package specifiers and relative paths that merely end in the marker", () => {
    assert.strictEqual(
      findOpencodePluginEntry(["opencode-plugin", "@scope/opencode-plugin", "./opencode-plugin"], "opencode-plugin"),
      null
    );
  });
});
