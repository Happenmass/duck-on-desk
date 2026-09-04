const { describe, it } = require("node:test");
const assert = require("node:assert");
const { formatNodeHookCommand } = require("../hooks/json-utils");
const { withCommandEnv } = require("../hooks/codex-install-utils");
const {
  validateHookCommand,
  validateHookTarget,
} = require("../src/doctor-detectors/agent-node-bin-parser");

function fakeFs(existingPaths) {
  const existing = new Set(existingPaths);
  return {
    existsSync: (filePath) => existing.has(filePath),
    accessSync: (filePath) => {
      if (!existing.has(filePath)) throw new Error(`missing ${filePath}`);
    },
  };
}

describe("doctor hook command parser", () => {
  it("validates POSIX absolute node and script paths", () => {
    const nodeBin = "/usr/local/bin/node";
    const scriptPath = "/opt/duck/hooks/cursor-hook.js";
    const command = formatNodeHookCommand(nodeBin, scriptPath, { platform: "linux" });

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "linux",
        fs: fakeFs([nodeBin, scriptPath]),
      }),
      { ok: true, nodeBin, scriptPath }
    );
  });

  it("trusts bare node on Windows PowerShell commands", () => {
    const scriptPath = "D:/animation/hooks/codex-hook.js";
    const command = formatNodeHookCommand("node", scriptPath, {
      platform: "win32",
      windowsWrapper: "powershell",
    });

    assert.deepStrictEqual(
      validateHookCommand(command, { platform: "win32", fs: fakeFs([scriptPath]) }),
      { ok: true, nodeBin: "node", scriptPath }
    );
  });

  it("validates absolute Windows node paths", () => {
    const nodeBin = "C:\\Program Files\\nodejs\\node.exe";
    const scriptPath = "D:/animation/hooks/agent-e-hook.js";
    const command = formatNodeHookCommand(nodeBin, scriptPath, {
      platform: "win32",
      windowsWrapper: "powershell",
    });

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "win32",
        fs: fakeFs([nodeBin, scriptPath]),
      }),
      { ok: true, nodeBin, scriptPath }
    );
  });

  it("validates direct process executor node/script targets without shell parsing", () => {
    const nodeBin = "C:\\Program Files\\nodejs\\node.exe";
    const scriptPath = "D:/Program Files/Duck/hooks/agent-f-hook.js";

    assert.deepStrictEqual(
      validateHookTarget({ nodeBin, scriptPath }, {
        platform: "win32",
        fs: fakeFs([nodeBin, scriptPath]),
      }),
      { ok: true, nodeBin, scriptPath }
    );
  });

  it("rejects non-Node and bare executables for strict process targets", () => {
    const cmdBin = "C:\\Windows\\System32\\cmd.exe";
    const scriptPath = "D:/Program Files/Duck/hooks/agent-f-hook.js";

    assert.deepStrictEqual(
      validateHookTarget({ nodeBin: cmdBin, scriptPath }, {
        platform: "win32",
        fs: fakeFs([cmdBin, scriptPath]),
        requireAbsoluteNode: true,
        requireNodeExecutable: true,
      }),
      {
        ok: false,
        issue: "nodeBin-invalid",
        nodeBin: cmdBin,
        scriptPath,
      }
    );
    assert.deepStrictEqual(
      validateHookTarget({ nodeBin: "node", scriptPath }, {
        platform: "win32",
        fs: fakeFs([scriptPath]),
        requireAbsoluteNode: true,
        requireNodeExecutable: true,
      }),
      {
        ok: false,
        issue: "nodeBin-invalid",
        nodeBin: "node",
        scriptPath,
      }
    );
  });

  it("does not mistake preload scripts for the hook script", () => {
    const nodeBin = "/usr/local/bin/node";
    const scriptPath = "/opt/duck/hooks/agent-g-hook.js";
    const command = `"${nodeBin}" "--require" "./pre.js" "${scriptPath}"`;

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "linux",
        fs: fakeFs([nodeBin, scriptPath]),
      }),
      { ok: true, nodeBin, scriptPath }
    );
  });

  it("unwraps Windows cmd /d /s /c commands", () => {
    const nodeBin = "C:\\Program Files\\nodejs\\node.exe";
    const scriptPath = "D:/animation/hooks/codex-debug-hook.js";
    const command = formatNodeHookCommand(nodeBin, scriptPath, {
      platform: "win32",
      windowsWrapper: "cmd",
    });

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "win32",
        fs: fakeFs([nodeBin, scriptPath]),
      }),
      { ok: true, nodeBin, scriptPath }
    );
  });

  it("strips POSIX env prefixes", () => {
    const nodeBin = "/usr/local/bin/node";
    const scriptPath = "/opt/duck/hooks/codex-hook.js";
    const base = formatNodeHookCommand(nodeBin, scriptPath, { platform: "linux" });
    const command = withCommandEnv(base, { DUCK_HOOK_DEBUG: "1" }, "linux");

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "linux",
        fs: fakeFs([nodeBin, scriptPath]),
      }),
      { ok: true, nodeBin, scriptPath }
    );
  });

  it("strips one PowerShell env prefix", () => {
    const scriptPath = "D:/animation/hooks/codex-hook.js";
    const base = formatNodeHookCommand("node", scriptPath, {
      platform: "win32",
      windowsWrapper: "powershell",
    });
    const command = withCommandEnv(base, { DUCK_REMOTE: "1" }, "win32");

    assert.deepStrictEqual(
      validateHookCommand(command, { platform: "win32", fs: fakeFs([scriptPath]) }),
      { ok: true, nodeBin: "node", scriptPath }
    );
  });

  it("strips multiple PowerShell env prefixes", () => {
    const scriptPath = "D:/animation/hooks/codex-hook.js";
    const base = formatNodeHookCommand("node", scriptPath, {
      platform: "win32",
      windowsWrapper: "powershell",
    });
    const command = withCommandEnv(base, { A: "1", B: "two" }, "win32");

    assert.deepStrictEqual(
      validateHookCommand(command, { platform: "win32", fs: fakeFs([scriptPath]) }),
      { ok: true, nodeBin: "node", scriptPath }
    );
  });

  it("reports missing script paths", () => {
    const nodeBin = "/usr/local/bin/node";
    const scriptPath = "/opt/duck/hooks/missing-hook.js";
    const command = formatNodeHookCommand(nodeBin, scriptPath, { platform: "linux" });

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "linux",
        fs: fakeFs([nodeBin]),
      }),
      { ok: false, issue: "scriptPath-missing", nodeBin, scriptPath }
    );
  });

  it("reports bare node as invalid on POSIX", () => {
    const scriptPath = "/opt/duck/hooks/cursor-hook.js";
    const command = formatNodeHookCommand("node", scriptPath, { platform: "linux" });

    assert.deepStrictEqual(
      validateHookCommand(command, {
        platform: "linux",
        fs: fakeFs([scriptPath]),
      }),
      { ok: false, issue: "nodeBin-invalid", nodeBin: "node", scriptPath }
    );
  });
});
