"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parse } = require("jsonc-parser");
const { createAgentMcpManager } = require("../src/state/agent-mcp");
const { createSettingsController } = require("../src/shell/settings-controller");
const prefs = require("../src/shell/prefs");
const labDir = path.resolve(__dirname, "../mcp/robot-lab");
function fixture(t, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "duck-mcp-client-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, "claude"), XDG_CONFIG_HOME: path.join(home, "config"), CODEX_HOME: path.join(home, "codex") };
  const manager = createAgentMcpManager({ home, env, labDir, nodeBin: async () => process.execPath, ...extra });
  return { home, env, manager };
}
function seed(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, { mode: 0o600 }); }

test("Claude: actual MCP startup before install, update, readback, remove; preserve other settings", async t => {
  const { env, manager } = fixture(t);
  const file = path.join(env.CLAUDE_CONFIG_DIR, ".claude.json");
  seed(file, '{"theme":"dark","mcpServers":{"existing":{"command":"keep"}},"projects":{"/repo":{"trust":true}}}\n');
  const before = JSON.parse(fs.readFileSync(file));
  assert.equal((await manager.inspect("claude-code")).installed, false);
  assert.equal((await manager.install("claude-code")).installed, true);
  const data = JSON.parse(fs.readFileSync(file));
  assert.equal(data.mcpServers["duck-robot-lab"].command, process.execPath);
  assert.deepEqual(data.projects, before.projects);
  assert.deepEqual(data.mcpServers.existing, before.mcpServers.existing);
  assert.equal((await manager.install("claude-code", process.execPath)).pythonPath, process.execPath);
  assert.equal((await manager.remove("claude-code")).installed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), before);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("OpenCode: JSONC precedence, comments and unrelated MCP entries survive install/removal", async t => {
  const { env, manager } = fixture(t);
  const low = path.join(env.XDG_CONFIG_HOME, "opencode/opencode.json");
  const high = path.join(env.XDG_CONFIG_HOME, "opencode/opencode.jsonc");
  seed(low, '{"mcp":{"other":{"type":"local","command":["keep"]}}}');
  seed(high, '{\n // user comment\n "theme":"dark",\n}');
  const beforeLow = fs.readFileSync(low, "utf8");
  await manager.install("opencode");
  let text = fs.readFileSync(high, "utf8");
  assert.match(text, /user comment/);
  assert.equal(parse(text).mcp["duck-robot-lab"].type, "local");
  assert.equal(fs.readFileSync(low, "utf8"), beforeLow);
  // A lower-priority managed entry must not resurrect after removal.
  const value = parse(fs.readFileSync(low, "utf8"));
  value.mcp["duck-robot-lab"] = parse(text).mcp["duck-robot-lab"];
  seed(low, JSON.stringify(value));
  await manager.remove("opencode");
  assert.equal((await manager.inspect("opencode")).installed, false);
  assert.deepEqual(parse(fs.readFileSync(low, "utf8")).mcp.other, { type: "local", command: ["keep"] });
  assert.match(fs.readFileSync(high, "utf8"), /user comment/);
});

test("conflicts, invalid configs and unsupported clients never overwrite files", async t => {
  const { env, manager } = fixture(t);
  const file = path.join(env.CLAUDE_CONFIG_DIR, ".claude.json");
  for (const content of ['{"mcpServers":{"duck-robot-lab":{"command":"external"}}}', '{broken', '{"mcpServers":{},"mcpServers":{}}']) {
    seed(file, content);
    await assert.rejects(manager.install("claude-code"));
    await assert.rejects(manager.remove("claude-code"));
    assert.equal(fs.readFileSync(file, "utf8"), content);
  }
  assert.equal((await manager.inspect("pi")).supported, false);
  await assert.rejects(manager.install("pi"));
  await assert.rejects(manager.install("unknown"));
});

test("unstartable MCP refuses installation before writing config", async t => {
  const { env, manager } = fixture(t, { run: async () => { throw new Error("broken dependency"); } });
  await assert.rejects(manager.install("claude-code"), /could not start/);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, ".claude.json")), false);
});

test("settings command path installs and removes without changing hook enablement", async t => {
  const { manager } = fixture(t);
  const controller = createSettingsController({ loadResult: { snapshot: prefs.getDefaults(), locked: false }, injectedDeps: { agentMcpManager: manager } });
  const before = controller.getSnapshot().agents;
  const result = await controller.applyCommand("installAgentMcp", { agentId: "claude-code" });
  assert.equal(result.installed, true);
  assert.equal((await controller.applyCommand("getAgentMcpStatus", { agentId: "claude-code" })).installed, true);
  assert.equal((await controller.applyCommand("removeAgentMcp", { agentId: "claude-code" })).installed, false);
  assert.deepEqual(controller.getSnapshot().agents, before);
});

test("Codex official CLI round trip in isolated CODEX_HOME", { skip: !process.env.DUCK_MCP_CODEX_BIN }, async t => {
  const { env, manager } = fixture(t, { cli: async () => ({ command: process.env.DUCK_MCP_CODEX_BIN, prefix: [] }) });
  const file = path.join(env.CODEX_HOME, "config.toml");
  assert.equal((await manager.inspect("codex")).installed, false);
  assert.equal((await manager.install("codex")).installed, true);
  await manager.remove("codex");
  seed(file, '# preserve this comment\nmodel = "test-model"\n[mcp_servers.other]\ncommand = "keep"\n');
  assert.equal((await manager.inspect("codex")).installed, false);
  assert.equal((await manager.install("codex")).installed, true);
  assert.equal((await manager.install("codex", process.execPath)).pythonPath, process.execPath);
  assert.equal((await manager.remove("codex")).installed, false);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /preserve this comment/);
  assert.match(text, /command = "keep"/);
  assert.match(text, /model = "test-model"/);
});
