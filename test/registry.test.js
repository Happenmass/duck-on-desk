const { describe, it } = require("node:test");
const assert = require("node:assert");
const registry = require("../agents/registry");

describe("Agent Registry", () => {
  it("should return all supported agents", () => {
    const agents = registry.getAllAgents();
    const ids = agents.map((a) => a.id);
    assert.deepStrictEqual(ids, [
      "claude-code",
      "codex",
      "opencode",
      "pi",
    ]);
  });

  it("should look up agents by ID", () => {
    assert.strictEqual(registry.getAgent("claude-code").name, "Claude Code");
    assert.strictEqual(registry.getAgent("codex").name, "Codex CLI");
    assert.strictEqual(registry.getAgent("opencode").name, "OpenCode");
    assert.strictEqual(registry.getAgent("pi").name, "Pi");
    assert.strictEqual(registry.getAgent("nonexistent"), undefined);
  });

  it("should return correct process names for Windows", () => {
    // Temporarily mock platform if needed — just check the data structure
    const cc = registry.getAgent("claude-code");
    assert.deepStrictEqual(cc.processNames.win, ["claude.exe"]);
    assert.deepStrictEqual(cc.processNames.mac, ["claude"]);

    const codex = registry.getAgent("codex");
    assert.deepStrictEqual(codex.processNames.win, ["codex.exe"]);

    const opencode = registry.getAgent("opencode");
    assert.deepStrictEqual(opencode.processNames.win, ["opencode.exe"]);

    const pi = registry.getAgent("pi");
    assert.deepStrictEqual(pi.processNames.win, ["pi.exe"]);
  });

  it("should include explicit Linux process names", () => {
    const cc = registry.getAgent("claude-code");
    assert.deepStrictEqual(cc.processNames.linux, ["claude"]);

    const codex = registry.getAgent("codex");
    assert.deepStrictEqual(codex.processNames.linux, ["codex"]);

    const opencode = registry.getAgent("opencode");
    assert.deepStrictEqual(opencode.processNames.linux, ["opencode"]);

    const pi = registry.getAgent("pi");
    assert.deepStrictEqual(pi.processNames.linux, ["pi"]);
  });

  it("should aggregate all process names", () => {
    const all = registry.getAllProcessNames();
    assert.ok(all.length >= 4);
    // Should contain at least one entry per agent (platform-dependent)
    const agentIds = [...new Set(all.map((p) => p.agentId))];
    assert.ok(agentIds.includes("claude-code"));
    assert.ok(agentIds.includes("codex"));
    assert.ok(agentIds.includes("opencode"));
    assert.ok(agentIds.includes("pi"));
  });

  it("requires every agent to declare an explicit startup recovery surface", () => {
    for (const agent of registry.getAllAgents()) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(agent, "startupRecoveryProcessNames"),
        `${agent.id} must explicitly declare startupRecoveryProcessNames`
      );
      for (const platform of ["win", "mac", "linux"]) {
        assert.ok(
          Array.isArray(agent.startupRecoveryProcessNames[platform]),
          `${agent.id} must declare startupRecoveryProcessNames.${platform}`
        );
      }
    }

    const startupAgentIds = new Set(
      registry.getStartupRecoveryProcessNames().map((entry) => entry.agentId)
    );
    assert.ok(startupAgentIds.has("claude-code"));
    assert.ok(startupAgentIds.has("codex"));
    assert.ok(startupAgentIds.has("opencode"));
  });

  it("keeps ambiguous POSIX process names out of startup recovery", () => {
    // A bare `pi` is ambiguous on POSIX; only the Windows executable is safe
    // for pure-name startup recovery.
    assert.deepStrictEqual(
      registry.getAgent("pi").startupRecoveryProcessNames,
      { win: ["pi.exe"], mac: [], linux: [] }
    );
  });

  it("should have correct capabilities", () => {
    const cc = registry.getAgent("claude-code");
    assert.strictEqual(cc.capabilities.httpHook, true);
    assert.strictEqual(cc.capabilities.permissionApproval, true);
    assert.strictEqual(cc.capabilities.sessionEnd, true);
    assert.strictEqual(cc.capabilities.subagent, true);

    const codex = registry.getAgent("codex");
    assert.strictEqual(codex.capabilities.httpHook, false);
    assert.strictEqual(codex.capabilities.permissionApproval, true);
    assert.strictEqual(codex.capabilities.sessionEnd, false);
    assert.strictEqual(codex.capabilities.subagent, false);

    const opencode = registry.getAgent("opencode");
    assert.strictEqual(opencode.capabilities.httpHook, false);
    assert.strictEqual(opencode.capabilities.permissionApproval, true);
    assert.strictEqual(opencode.capabilities.sessionEnd, true);
    assert.strictEqual(opencode.capabilities.subagent, false);

    const pi = registry.getAgent("pi");
    assert.strictEqual(pi.capabilities.httpHook, false);
    assert.strictEqual(pi.capabilities.permissionApproval, false);
    assert.strictEqual(pi.capabilities.interactiveBubble, false);
    assert.strictEqual(pi.capabilities.sessionEnd, true);
    assert.strictEqual(pi.capabilities.subagent, false);
  });

  it("should have eventMap for hook-based agents", () => {
    const cc = registry.getAgent("claude-code");
    assert.strictEqual(cc.eventMap.SessionStart, "idle");
    assert.strictEqual(cc.eventMap.PreToolUse, "working");
    assert.strictEqual(cc.eventMap.Stop, "attention");

    const codex = registry.getAgent("codex");
    assert.strictEqual(codex.eventMap.SessionStart, "idle");
    assert.strictEqual(codex.eventMap.PreToolUse, "working");
    assert.strictEqual(codex.eventMap.PermissionRequest, "notification");

    const opencode = registry.getAgent("opencode");
    assert.strictEqual(opencode.eventSource, "plugin-event");
    assert.strictEqual(opencode.eventMap.SessionStart, "idle");
    assert.strictEqual(opencode.eventMap.UserPromptSubmit, "thinking");

    const pi = registry.getAgent("pi");
    assert.strictEqual(pi.eventSource, "extension");
    assert.strictEqual(pi.eventMap.SessionStart, "idle");
    assert.strictEqual(pi.eventMap.UserPromptSubmit, "thinking");
    assert.strictEqual(pi.eventMap.PostToolUseFailure, "error");
    assert.strictEqual(pi.eventMap.PreCompact, "sweeping");
  });

  it("should have logEventMap for poll-based agents", () => {
    const codex = registry.getAgent("codex");
    assert.strictEqual(codex.logEventMap["session_meta"], "idle");
    assert.strictEqual(codex.logEventMap["event_msg:task_started"], "thinking");
    assert.strictEqual(codex.logEventMap["event_msg:guardian_assessment"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:exec_command_end"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:patch_apply_end"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:custom_tool_call_output"], "working");
    assert.strictEqual(codex.logEventMap["event_msg:task_complete"], "codex-turn-end");
    assert.strictEqual(codex.logEventMap["event_msg:turn_aborted"], "idle");
  });
});
