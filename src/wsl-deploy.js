"use strict";

// One-click WSL integration deployment. Command-hook integrations keep their
// historical ~/.claude/hooks payload.

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const wslUtils = require("./wsl-utils");

// Every top-level .js file in hooks/ is deployed.
function collectHookFiles(hooksDir) {
  const files = [];
  try {
    for (const name of fs.readdirSync(hooksDir)) {
      if (!name.endsWith(".js")) continue;
      const full = path.join(hooksDir, name);
      if (!fs.statSync(full).isFile()) continue;
      files.push({ name, relativePath: name, path: full, content: fs.readFileSync(full, "utf8") });
    }
  } catch (err) {
    console.warn("Duck: collectHookFiles failed:", err && err.message ? err.message : err);
    throw err;
  }
  return files;
}

function validateDeployRelativePath(value) {
  if (typeof value !== "string" || !value) throw new Error("deploy path must be a non-empty string");
  if (value.includes("\0") || value.includes("\\") || value.includes("\r") || value.includes("\n")) {
    throw new Error(`invalid deploy path: ${JSON.stringify(value)}`);
  }
  if (path.posix.isAbsolute(value)) throw new Error(`absolute deploy path is not allowed: ${value}`);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe deploy path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value) throw new Error(`non-canonical deploy path: ${value}`);
  return normalized;
}

// Map agentId to the install script that runs in WSL.
const AGENT_INSTALL_SCRIPT = {
  "claude-code": "install.js",
  codex: "codex-install.js",
  // OpenCode / Pi remain unsupported until their complete WSL runtime
  // behavior is independently validated.
};

function getInstallScript(agentId) {
  return getAgentInstallScriptName(agentId);
}

function getAgentInstallArgs() {
  return "";
}

// install.js does not implement --uninstall; Claude uses uninstall.js.
const AGENT_UNINSTALL_COMMAND = {
  "claude-code": "uninstall.js",
};

function getAgentUninstallCommand(agentId) {
  if (AGENT_UNINSTALL_COMMAND[agentId]) return AGENT_UNINSTALL_COMMAND[agentId];
  const installScript = getAgentInstallScriptName(agentId);
  return installScript ? `${installScript} --uninstall` : null;
}

function resolveHooksDir({ isPackaged, resourcesPath } = {}) {
  if (isPackaged) {
    const root = resourcesPath || process.resourcesPath;
    if (typeof root !== "string" || !root) throw new Error("resourcesPath is required for packaged WSL deploy");
    return path.join(root, "app.asar.unpacked", "hooks");
  }
  return path.join(__dirname, "..", "hooks");
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function isSafeAbsolutePosixPath(value) {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.includes("\0")
    && !value.includes("\r")
    && !value.includes("\n")
    && !value.includes("\\");
}

function getDependency(options, name, fallback) {
  return options && typeof options[name] === "function" ? options[name] : fallback;
}

function isWindowsFor(options) {
  return getDependency(options, "isWindows", wslUtils.isWindows)();
}

// Pipe bytes into a validated path below one WSL directory.
function pipeFileToWsl(distro, wslDestDir, fileName, content, options = {}) {
  let relativePath;
  try {
    relativePath = validateDeployRelativePath(fileName);
    if (!isSafeAbsolutePosixPath(wslDestDir)) throw new Error("invalid WSL destination directory");
  } catch (err) {
    return Promise.resolve({ ok: false, fileName, error: err.message });
  }

  return new Promise((resolve) => {
    const root = wslDestDir.replace(/\/+$/, "");
    const safePath = `${root}/${relativePath}`;
    const parentDir = path.posix.dirname(safePath);
    const cmd = `mkdir -p -- ${quotePosix(parentDir)} && cat > ${quotePosix(safePath)}`;
    const spawn = getDependency(options, "spawn", childProcess.spawn);
    let child;
    try {
      child = spawn("wsl.exe", ["-d", distro, "--", "bash", "-c", cmd], {
        env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, fileName: relativePath, error: err && err.message ? err.message : "spawn failed" });
      return;
    }

    const stderrChunks = [];
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, fileName: relativePath, error: "timeout" });
    }, options.timeout || 30000);

    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, fileName: relativePath, error: err && err.message ? err.message : "spawn failed" });
    });
    if (child.stderr) child.stderr.on("data", (data) => { stderrChunks.push(data); });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      resolve(code === 0
        ? { ok: true, fileName: relativePath, stderr: stderr || null }
        : { ok: false, fileName: relativePath, error: stderr || `exit code ${code}` });
    });

    if (!child.stdin) {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, fileName: relativePath, error: "no stdin" });
      return;
    }
    child.stdin.on("error", () => {});
    if (Buffer.isBuffer(content)) child.stdin.end(content);
    else child.stdin.end(content, "utf8");
  });
}

function parseConnectivityProbe(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  const match = text.match(/^REACHABLE (\d+)$/m);
  if (match) return { reachable: true, port: parseInt(match[1], 10) };
  if (/^UNREACHABLE$/m.test(text)) return { reachable: false, port: null };
  return { reachable: null, port: null };
}

async function copyEntriesToWsl(distro, targetDir, entries, options, emit) {
  const upload = getDependency(options, "pipeFileToWsl", pipeFileToWsl);
  let copied = 0;
  const errors = [];
  emit("copy-files", "start");
  for (const entry of entries) {
    const relativePath = entry.relativePath || entry.name;
    let result;
    try {
      result = await upload(distro, targetDir, relativePath, entry.content, options);
    } catch (err) {
      result = { ok: false, fileName: relativePath, error: err && err.message ? err.message : String(err) };
    }
    if (result && result.ok) {
      copied++;
      if (result.stderr) emit("copy-files", "stderr", null, { fileName: relativePath, stderr: result.stderr.slice(0, 200) });
    } else {
      errors.push(result || { fileName: relativePath, error: "upload failed" });
    }
  }
  if (errors.length) {
    const names = errors.map((entry) => entry.fileName).join(", ");
    const message = `Failed to copy ${errors.length} file(s): ${names}`;
    emit("copy-files", "fail", message);
    return { ok: false, copied, errors, message };
  }
  emit("copy-files", "ok", null, { copied, total: entries.length });
  return { ok: true, copied };
}

function progressEmitter(distro, options) {
  return (step, status, message, hint) => {
    if (typeof options.onProgress === "function") {
      options.onProgress({ distro, step, status, message: message || null, hint: hint || null });
    }
  };
}

async function deployPersistentToWsl(distro, agentId, installScript, entries, options, emit) {
  const getWslHomeDir = getDependency(options, "getWslHomeDir", wslUtils.getWslHomeDir);
  const execInWsl = getDependency(options, "execInWsl", wslUtils.execInWsl);
  emit("prepare-dir", "start");
  const wslHome = await getWslHomeDir(distro, options);
  if (!wslHome) {
    const message = `Could not resolve $HOME in WSL ${distro}`;
    emit("prepare-dir", "fail", message);
    return { ok: false, step: "prepare-dir", message };
  }
  const hooksTargetDir = `${wslHome}/.claude/hooks`;
  const mkdirResult = await execInWsl(distro, `mkdir -p ${quotePosix(hooksTargetDir)}`, options);
  if (!mkdirResult || mkdirResult.code !== 0) {
    const message = (mkdirResult && mkdirResult.stderr) || "mkdir failed";
    emit("prepare-dir", "fail", message);
    return { ok: false, step: "prepare-dir", message };
  }
  emit("prepare-dir", "ok", null, { hooksTargetDir });

  const copied = await copyEntriesToWsl(distro, hooksTargetDir, entries, options, emit);
  if (!copied.ok) return { ok: false, step: "copy-files", message: copied.message, errors: copied.errors };

  emit("run-install", "start");
  const distroEscaped = distro.replace(/'/g, "'\\''");
  const installArgs = getAgentInstallArgs(agentId);
  const runResult = await execInWsl(
    distro,
    `cd ${quotePosix(hooksTargetDir)} && DUCK_WSL_DISTRO='${distroEscaped}' node ${installScript}${installArgs ? ` ${installArgs}` : ""}`,
    { ...options, shell: "bash", shellFlags: ["-l", "-i", "-c"], timeout: 60000 }
  );
  if (!runResult || runResult.code !== 0) {
    const message = (runResult && runResult.stderr) || `${installScript} failed`;
    emit("run-install", "fail", message);
    return { ok: false, step: "run-install", message };
  }
  emit("run-install", "ok");

  emit("verify-connectivity", "start");
  const probeResult = await execInWsl(
    distro,
    `cd ${quotePosix(hooksTargetDir)} && node wsl-connectivity-probe.js`,
    { ...options, shell: "bash", shellFlags: ["-l", "-i", "-c"], timeout: 20000 }
  );
  const connectivity = parseConnectivityProbe(probeResult && probeResult.stdout);
  if (connectivity.reachable === true) emit("verify-connectivity", "ok", null, { port: connectivity.port });
  else if (connectivity.reachable === false) emit("verify-connectivity", "warn", "Duck HTTP server unreachable from WSL (NAT networking?)");
  else emit("verify-connectivity", "skip", (probeResult && probeResult.stderr) || null);

  return {
    ok: true,
    distro,
    agentId,
    hooksTargetDir,
    filesCopied: copied.copied,
    connectivity: connectivity.reachable,
    connectivityPort: connectivity.port,
  };
}

async function deployToWsl(distro, options = {}) {
  if (!isWindowsFor(options)) return { ok: false, step: "platform", message: "WSL deploy only runs on Windows" };
  if (!distro) return { ok: false, step: "args", message: "distro name is required" };

  const agentId = options.agentId || "claude-code";
  const installScript = getInstallScript(agentId);
  if (!installScript) return { ok: false, step: "unsupported", message: `WSL deploy is not supported for ${agentId}` };

  const emit = progressEmitter(distro, options);
  emit("verify-files", "start");
  let hooksDir;
  let entries;
  try {
    hooksDir = options.hooksDir || resolveHooksDir(options);
    entries = collectHookFiles(hooksDir);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    emit("verify-files", "fail", message);
    return { ok: false, step: "verify-files", message };
  }
  if (!entries.length || !entries.some((entry) => entry.relativePath === installScript)) {
    const message = !entries.length ? `No hook files found in ${hooksDir}` : `Install script ${installScript} not found in ${hooksDir}`;
    emit("verify-files", "fail", message);
    return { ok: false, step: "verify-files", message };
  }
  emit("verify-files", "ok", null, { fileCount: entries.length });

  return deployPersistentToWsl(distro, agentId, installScript, entries, options, emit);
}

async function removePersistentFromWsl(distro, options, emit) {
  const getWslHomeDir = getDependency(options, "getWslHomeDir", wslUtils.getWslHomeDir);
  const execInWsl = getDependency(options, "execInWsl", wslUtils.execInWsl);
  const wslHome = await getWslHomeDir(distro, options);
  if (!wslHome) return { ok: false, step: "home", message: `Could not resolve $HOME in WSL ${distro}` };

  const hooksDir = `${wslHome}/.claude/hooks`;
  const agentId = options.agentId || "claude-code";
  emit("remove", "start");
  const uninstallCommand = getAgentUninstallCommand(agentId);
  if (uninstallCommand) {
    const uninstallResult = await execInWsl(
      distro,
      `cd ${quotePosix(hooksDir)} && node ${uninstallCommand}`,
      { ...options, shell: "bash", shellFlags: ["-l", "-i", "-c"], timeout: 30000 }
    );
    if (!uninstallResult || uninstallResult.code !== 0) {
      emit("remove", "stderr", (uninstallResult && uninstallResult.stderr) || "uninstall failed");
    }
  }

  if (options.removeFiles === true) {
    const rmResult = await execInWsl(distro, `rm -rf ${quotePosix(hooksDir)}`, { ...options, timeout: 30000 });
    if (!rmResult || rmResult.code !== 0) {
      const message = (rmResult && rmResult.stderr) || "rm failed";
      emit("remove", "fail", message);
      return { ok: false, step: "remove", message };
    }
  }
  emit("remove", "ok");
  return { ok: true, distro, agentId, filesRemoved: options.removeFiles === true };
}

async function removeFromWsl(distro, options = {}) {
  if (!isWindowsFor(options)) return { ok: false, step: "platform", message: "WSL remove only runs on Windows" };
  if (!distro) return { ok: false, step: "args", message: "distro name is required" };
  const agentId = options.agentId || "claude-code";
  const emit = progressEmitter(distro, options);
  return removePersistentFromWsl(distro, options, emit);
}

function getAgentInstallScriptName(agentId) {
  return AGENT_INSTALL_SCRIPT[agentId] || null;
}

module.exports = {
  collectHookFiles,
  deployToWsl,
  getAgentInstallArgs,
  getAgentInstallScriptName,
  getAgentUninstallCommand,
  parseConnectivityProbe,
  pipeFileToWsl,
  removeFromWsl,
  resolveHooksDir,
  validateDeployRelativePath,
};
