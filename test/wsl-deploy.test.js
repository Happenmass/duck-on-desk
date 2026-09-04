"use strict";

// Unit tests for src/wsl-deploy.js (agent install script mapping, hooks dir resolution)
// Does NOT require Windows or WSL.

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("path");
const { builtinModules } = require("node:module");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  HERMES_RESULT_SENTINEL,
  HERMES_TEMP_SENTINEL,
  HERMES_WSL_FILES,
  collectAgentWslFiles,
  createHermesTempDir,
  deployToWsl,
  getAgentInstallArgs,
  getAgentInstallScriptName,
  parseHermesInstallerResult,
  parseHermesTempDir,
  pipeFileToWsl,
  removeFromWsl,
  resolveHooksDir,
  validateDeployRelativePath,
} = require("../src/wsl-deploy");

const HOOKS_DIR = path.join(__dirname, "..", "hooks");

describe("wsl-deploy", () => {
  describe("getAgentInstallScriptName", () => {
    it("maps claude-code to install.js", () => {
      assert.strictEqual(getAgentInstallScriptName("claude-code"), "install.js");
    });

    it("maps codex to codex-install.js", () => {
      assert.strictEqual(getAgentInstallScriptName("codex"), "codex-install.js");
    });

    it("returns null for unsupported agents", () => {
      assert.strictEqual(getAgentInstallScriptName("unknown-agent"), null);
      assert.strictEqual(getAgentInstallScriptName(""), null);
    });

    it("excludes workbuddy (no standalone Linux/WSL runtime)", () => {
      // WorkBuddy ships only as a macOS/Windows Electron desktop app, so there
      // is no in-WSL settings.json to deploy hooks into. See AGENT_INSTALL_SCRIPT.
      assert.strictEqual(getAgentInstallScriptName("workbuddy"), null);
    });

  });

  describe("getAgentInstallArgs", () => {
    it("keeps the in-app Claude WSL deploy transcript-only (no automatic statusline)", () => {
      assert.strictEqual(getAgentInstallArgs("claude-code"), "");
    });

  });

  describe("getAgentUninstallCommand", () => {
    const { getAgentUninstallCommand } = require("../src/wsl-deploy");

    it("uses uninstall.js for claude-code (install.js has no --uninstall flag)", () => {
      assert.strictEqual(getAgentUninstallCommand("claude-code"), "uninstall.js");
    });

    it("uses <install-script> --uninstall for other agents", () => {
      assert.strictEqual(getAgentUninstallCommand("codex"), "codex-install.js --uninstall");
    });

    it("returns null for unsupported agents", () => {
      assert.strictEqual(getAgentUninstallCommand("unknown-agent"), null);
      assert.strictEqual(getAgentUninstallCommand("pi"), null);
    });
  });

  describe("parseConnectivityProbe", () => {
    const { parseConnectivityProbe } = require("../src/wsl-deploy");

    it("parses REACHABLE with port", () => {
      assert.deepStrictEqual(
        parseConnectivityProbe("REACHABLE 23333\n"),
        { reachable: true, port: 23333 }
      );
    });

    it("ignores login-shell noise around the marker", () => {
      assert.deepStrictEqual(
        parseConnectivityProbe("bash: warning\nREACHABLE 23334\n"),
        { reachable: true, port: 23334 }
      );
    });

    it("parses UNREACHABLE", () => {
      assert.deepStrictEqual(
        parseConnectivityProbe("UNREACHABLE\n"),
        { reachable: false, port: null }
      );
    });

    it("returns unknown for garbage, empty, or missing output", () => {
      assert.deepStrictEqual(parseConnectivityProbe(""), { reachable: null, port: null });
      assert.deepStrictEqual(parseConnectivityProbe(undefined), { reachable: null, port: null });
      assert.deepStrictEqual(parseConnectivityProbe("node: command not found"), { reachable: null, port: null });
    });
  });

  describe("resolveHooksDir", () => {
    it("returns dev path when not packaged", () => {
      const dir = resolveHooksDir({ isPackaged: false });
      assert.ok(dir.endsWith(path.join("src", "..", "hooks")) || dir.endsWith("hooks"));
    });

    it("defaults to dev path when no options", () => {
      const dir = resolveHooksDir();
      assert.ok(typeof dir === "string" && dir.length > 0);
    });

    it("accepts an injected packaged resources path", () => {
      assert.strictEqual(
        resolveHooksDir({ isPackaged: true, resourcesPath: "C:\\Clawd\\resources" }),
        path.join("C:\\Clawd\\resources", "app.asar.unpacked", "hooks")
      );
    });
  });

});
