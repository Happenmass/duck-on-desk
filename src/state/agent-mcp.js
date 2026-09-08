"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { parse, parseTree, modify, applyEdits } = require("jsonc-parser");
const { resolveNodeBinAsync } = require("../../hooks/server-config");

const SERVER_NAME = "duck-robot-lab";
const OWNER_KEY = "DUCK_LAB_MANAGED_BY";
const SUPPORTED = new Set(["claude-code", "codex", "opencode"]);
const execute = promisify(execFile);
function object(value) { return value && typeof value === "object" && !Array.isArray(value); }

function readConfig(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return { file, text: "{}\n", value: {}, exists: false }; throw error; }
  const errors = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  const value = parse(text, [], { allowTrailingComma: true });
  // A duplicate property makes targeted editing ambiguous (parser and editor
  // may pick different occurrences). Never replace an unreadable config.
  function check(node) {
    if (node.type === "object") {
      const keys = node.children.map(p => p.children[0].value);
      if (new Set(keys).size !== keys.length) throw new Error("Duplicate config keys; resolve them before installing MCP.");
    }
    for (const child of node.children || []) check(child);
  }
  if (errors.length || !object(value)) throw new Error("Invalid client configuration; repair it before installing MCP.");
  check(tree);
  return { file, text, value, exists: true };
}
function writeEntry(config, key, value) {
  const text = applyEdits(config.text, modify(config.text, [key, SERVER_NAME], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  if (text === config.text) return;
  fs.mkdirSync(path.dirname(config.file), { recursive: true });
  // Reread before replacing so a concurrent edit does not get overwritten.
  const current = readConfig(config.file);
  if (current.text !== config.text || current.exists !== config.exists) throw new Error("Configuration changed; refresh and retry.");
  const mode = config.exists ? fs.statSync(config.file).mode & 0o777 : 0o600;
  const temporary = `${config.file}.${process.pid}.mcp-tmp`;
  try {
    fs.writeFileSync(temporary, text, { flag: "wx", mode });
    fs.renameSync(temporary, config.file);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

function createAgentMcpManager(options = {}) {
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const run = options.run || ((command, args, extra = {}) => execute(command, args, {
    env, cwd: home, timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true, ...extra,
  }));
  const labDir = options.labDir || (process.resourcesPath
    ? path.join(process.resourcesPath, "robot-lab-mcp")
    : path.resolve(__dirname, "../../mcp/robot-lab"));
  const nodeBin = options.nodeBin || (() => resolveNodeBinAsync());
  async function cli(name) {
    if (options.cli) return options.cli(name);
    const dirs = (env.PATH || "").split(path.delimiter).concat([
      path.join(home, ".local", "bin"), path.join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin",
    ]);
    for (const dir of dirs) {
      for (const suffix of process.platform === "win32" ? [".exe", ".cmd", ""] : [""]) {
        const file = path.resolve(dir, name + suffix);
        if (!fs.existsSync(file)) continue;
        // npm's Windows wrapper can be launched through Node without a shell.
        if (suffix === ".cmd") {
          const entry = path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
          if (name === "codex" && fs.existsSync(entry)) return { command: await nodeBin(), prefix: [entry] };
          continue;
        }
        return { command: file, prefix: [] };
      }
    }
    throw new Error(`${name} CLI was not found. Install it or add it to PATH, then reopen Duck.`);
  }
  async function codex(args) {
    const resolved = await cli("codex");
    try { return await run(resolved.command, [...resolved.prefix, "mcp", ...args]); }
    catch (error) {
      // Do not forward CLI output: it may include unrelated credentials/config.
      if (args[0] === "get" && /No MCP server named/.test(error.stderr || "")) return null;
      throw new Error("Codex MCP command failed. Check the Codex CLI and its configuration.");
    }
  }
  function jsonConfigs(agentId) {
    if (agentId === "claude-code") {
      return [readConfig(env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json") : path.join(home, ".claude.json"))];
    }
    const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
    // Highest precedence first. Never hide a conflicting lower-priority entry.
    return ["opencode.jsonc", "opencode.json", "config.json"].map(name => readConfig(path.join(dir, name)));
  }
  async function entries(agentId) {
    if (!SUPPORTED.has(agentId)) throw new Error("This agent needs an MCP extension; automatic installation is not supported.");
    if (agentId === "codex") {
      if (!fs.existsSync(path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"))) return [];
      const result = await codex(["get", SERVER_NAME, "--json"]);
      return result ? [JSON.parse(result.stdout)] : [];
    }
    const key = agentId === "opencode" ? "mcp" : "mcpServers";
    return jsonConfigs(agentId).flatMap(c => {
      if (c.value[key] !== undefined && !object(c.value[key])) throw new Error("Invalid MCP configuration object.");
      return Object.hasOwn(c.value[key] || {}, SERVER_NAME) ? [c.value[key][SERVER_NAME]] : [];
    });
  }
  function owned(entry) { return entry && (entry.transport?.env || entry.environment || entry.env)?.[OWNER_KEY] === "duck-on-desk"; }
  async function inspect(agentId) {
    if (!SUPPORTED.has(agentId)) return { status: "ok", supported: false, installed: false };
    try {
      const found = await entries(agentId);
      const conflict = found.some(e => !owned(e));
      const active = found[0];
      const transport = active?.transport || active;
      const configEnv = transport?.env || transport?.environment || {};
      return { status: "ok", supported: true, installed: found.length > 0 && !conflict, conflict,
        disabled: active?.enabled === false, pythonPath: conflict ? "" : configEnv.DUCK_LAB_PYTHON || "" };
    } catch (error) { return { status: "error", supported: true, installed: false, message: error.message }; }
  }
  async function install(agentId, pythonPath = "") {
    if (typeof pythonPath !== "string" || pythonPath.length > 4096 || /[\r\n\0]/.test(pythonPath)) throw new Error("Invalid Python path.");
    if (pythonPath && (!path.isAbsolute(pythonPath) || !fs.existsSync(pythonPath))) throw new Error("Choose an existing Python executable using its absolute path.");
    const found = await entries(agentId);
    if (found.some(e => !owned(e))) throw new Error("An existing duck-robot-lab configuration is not managed by Duck; it was left unchanged.");
    const node = await nodeBin();
    if (!node) throw new Error("Node.js 22.12 or newer is required. Install Node.js and reopen Duck.");
    if (!fs.existsSync(path.join(labDir, "server.mjs"))) throw new Error("Robot Lab MCP is missing from this build.");
    // Real protocol check before touching client configuration. No user scripts.
    try { await run(node, [path.join(labDir, "check.mjs")], { env: { ...env, ...(pythonPath ? { DUCK_LAB_PYTHON: pythonPath } : {}) } }); }
    catch { throw new Error("Robot Lab MCP could not start. Check Node.js (22.12+) and the MCP dependencies."); }
    const definition = { command: node, args: [path.join(labDir, "server.mjs")], env: { [OWNER_KEY]: "duck-on-desk", ...(pythonPath ? { DUCK_LAB_PYTHON: pythonPath } : {}) } };
    if (agentId === "codex") {
      fs.mkdirSync(env.CODEX_HOME || path.join(home, ".codex"), { recursive: true });
      const args = ["add", SERVER_NAME];
      for (const [key, value] of Object.entries(definition.env)) args.push("--env", `${key}=${value}`);
      await codex([...args, "--", definition.command, ...definition.args]);
    } else {
      const configs = jsonConfigs(agentId);
      const key = agentId === "opencode" ? "mcp" : "mcpServers";
      // Recheck immediately before writing, including all precedence layers.
      if (configs.some(c => Object.hasOwn(c.value[key] || {}, SERVER_NAME) && !owned(c.value[key][SERVER_NAME]))) throw new Error("MCP configuration changed; refresh and retry.");
      const target = configs.find(c => c.exists) || configs[agentId === "opencode" ? 1 : 0];
      writeEntry(target, key, agentId === "opencode" ? { type: "local", command: [definition.command, ...definition.args], environment: definition.env, enabled: true } : { type: "stdio", ...definition });
    }
    const result = await inspect(agentId);
    if (!result.installed || result.disabled) throw new Error("MCP configuration could not be verified after installation.");
    return result;
  }
  async function remove(agentId) {
    const found = await entries(agentId);
    if (found.some(e => !owned(e))) throw new Error("This MCP configuration is not managed by Duck; it was left unchanged.");
    if (agentId === "codex") { if (found.length) await codex(["remove", SERVER_NAME]); }
    else {
      const key = agentId === "opencode" ? "mcp" : "mcpServers";
      for (const config of jsonConfigs(agentId)) {
        if (Object.hasOwn(config.value[key] || {}, SERVER_NAME)) {
          if (!owned(config.value[key][SERVER_NAME])) throw new Error("MCP configuration changed; refresh and retry.");
          writeEntry(config, key, undefined);
        }
      }
    }
    return inspect(agentId);
  }
  return { inspect, install, remove };
}
module.exports = { createAgentMcpManager };
