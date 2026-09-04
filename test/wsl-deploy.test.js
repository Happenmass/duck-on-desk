"use strict";

// Unit tests for src/wsl-deploy.js (agent install script mapping, hooks dir
// resolution, deploy-path validation, byte-exact file piping). Does NOT
// require Windows or WSL.

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const {
  deployToWsl,
  getAgentInstallArgs,
  getAgentInstallScriptName,
  getAgentUninstallCommand,
  parseConnectivityProbe,
  pipeFileToWsl,
  removeFromWsl,
  resolveHooksDir,
  validateDeployRelativePath,
} = require("../src/wsl-deploy");

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

    it("keeps OpenCode and Pi unsupported until their WSL runtime is validated", () => {
      assert.strictEqual(getAgentInstallScriptName("opencode"), null);
      assert.strictEqual(getAgentInstallScriptName("pi"), null);
    });
  });

  describe("getAgentInstallArgs", () => {
    it("keeps the in-app Claude WSL deploy transcript-only (no automatic statusline)", () => {
      assert.strictEqual(getAgentInstallArgs("claude-code"), "");
    });
  });

  describe("getAgentUninstallCommand", () => {
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

  describe("deployToWsl / removeFromWsl guards", () => {
    it("refuse to run off Windows before touching any dependency", async () => {
      const notWindows = { isWindows: () => false };
      assert.deepStrictEqual(await deployToWsl("Ubuntu", notWindows), {
        ok: false, step: "platform", message: "WSL deploy only runs on Windows",
      });
      assert.deepStrictEqual(await removeFromWsl("Ubuntu", notWindows), {
        ok: false, step: "platform", message: "WSL remove only runs on Windows",
      });
    });

    it("rejects unsupported agents before resolving the hooks dir", async () => {
      const result = await deployToWsl("Ubuntu", { isWindows: () => true, agentId: "pi" });
      assert.deepStrictEqual(result, { ok: false, step: "unsupported", message: "WSL deploy is not supported for pi" });
    });
  });

  describe("parseConnectivityProbe", () => {
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

  describe("validateDeployRelativePath", () => {
    it("rejects unsafe relative paths", () => {
      for (const value of ["", "/tmp/x", "../x", "a/../x", "a\\x", "a\0x", "a//x", "./x", "a/./x", "a\nx"]) {
        assert.throws(() => validateDeployRelativePath(value), `must reject ${JSON.stringify(value)}`);
      }
    });

    it("returns canonical top-level and nested paths unchanged", () => {
      assert.strictEqual(validateDeployRelativePath("codex-hook.js"), "codex-hook.js");
      assert.strictEqual(validateDeployRelativePath("vendor/helper.js"), "vendor/helper.js");
    });
  });

  describe("pipeFileToWsl", () => {
    function fakeSpawn(calls) {
      return (_command, args) => {
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stderr = new PassThrough();
        const chunks = [];
        child.stdin.on("data", (chunk) => chunks.push(chunk));
        child.stdin.on("finish", () => {
          calls.push({ args, content: Buffer.concat(chunks) });
          queueMicrotask(() => child.emit("close", 0));
        });
        child.kill = () => {};
        return child;
      };
    }

    it("pipes nested payload bytes without text conversion", async () => {
      const calls = [];
      const payload = Buffer.from([0x00, 0xff, 0x41, 0x0a]);

      const result = await pipeFileToWsl(
        "Ubuntu",
        "/home/u/.claude/hooks",
        "vendor/helper.js",
        payload,
        { spawn: fakeSpawn(calls), timeout: 1000 }
      );

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.fileName, "vendor/helper.js");
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0].content, payload);
      assert.match(calls[0].args.at(-1), /mkdir -p -- '\/home\/u\/\.claude\/hooks\/vendor'/);
      assert.match(calls[0].args.at(-1), /cat > '\/home\/u\/\.claude\/hooks\/vendor\/helper\.js'/);
    });

    it("refuses unsafe file names and destinations before spawning", async () => {
      const calls = [];
      const options = { spawn: fakeSpawn(calls), timeout: 1000 };
      const badName = await pipeFileToWsl("Ubuntu", "/home/u/.claude/hooks", "../escape.js", "x", options);
      assert.strictEqual(badName.ok, false);
      const badDest = await pipeFileToWsl("Ubuntu", "relative/dir", "codex-hook.js", "x", options);
      assert.strictEqual(badDest.ok, false);
      assert.match(badDest.error, /invalid WSL destination directory/);
      assert.strictEqual(calls.length, 0, "validation failures must never reach spawn");
    });
  });
});
