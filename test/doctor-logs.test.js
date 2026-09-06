"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  isAllowedLogBasename,
  openDuckLog,
  resolveDuckLogTarget,
} = require("../src/shell/doctor-logs");

describe("doctor log opener", () => {
  it("accepts only bare .log file names", () => {
    assert.strictEqual(isAllowedLogBasename("permission-debug.log"), true);
    assert.strictEqual(isAllowedLogBasename("codex-hook-debug.jsonl"), false);
    assert.strictEqual(isAllowedLogBasename("../permission-debug.log"), false);
    assert.strictEqual(isAllowedLogBasename("nested/permission-debug.log"), false);
  });

  it("resolves the newest allowed log across ~/.duck and userData", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "duck-doctor-logs-"));
    const homeDir = path.join(tmp, "home");
    const userDataDir = path.join(tmp, "userData");
    const duckDir = path.join(homeDir, ".duck-on-desk");
    fs.mkdirSync(duckDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    const oldLog = path.join(duckDir, "agent-debug.log");
    const newLog = path.join(userDataDir, "permission-debug.log");
    fs.writeFileSync(oldLog, "old");
    fs.writeFileSync(newLog, "new");
    const oldTime = new Date(Date.now() - 10_000);
    const newTime = new Date();
    fs.utimesSync(oldLog, oldTime, oldTime);
    fs.utimesSync(newLog, newTime, newTime);

    const target = resolveDuckLogTarget({ homeDir, userDataDir });

    assert.strictEqual(target.status, "file");
    assert.strictEqual(target.path, newLog);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("includes focus-debug.log in default log discovery", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "duck-doctor-focus-log-"));
    const userDataDir = path.join(tmp, "userData");
    fs.mkdirSync(userDataDir, { recursive: true });
    const focusLog = path.join(userDataDir, "focus-debug.log");
    fs.writeFileSync(focusLog, "focus");

    const target = resolveDuckLogTarget({ homeDir: tmp, userDataDir });

    assert.strictEqual(target.status, "file");
    assert.strictEqual(target.path, focusLog);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects path traversal requests", () => {
    const target = resolveDuckLogTarget({
      requested: "../permission-debug.log",
      homeDir: os.tmpdir(),
    });

    assert.deepStrictEqual(target, { status: "error", reason: "invalid-log-name" });
  });

  it("opens the fallback ~/.duck directory when no log exists", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "duck-doctor-log-open-"));
    const opened = [];
    const result = await openDuckLog({
      homeDir: tmp,
      shell: {
        openPath: async (target) => {
          opened.push(target);
          return "";
        },
      },
    });

    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.opened, "directory");
    assert.strictEqual(opened[0], path.join(tmp, ".duck-on-desk"));
    assert.strictEqual(fs.existsSync(opened[0]), true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
