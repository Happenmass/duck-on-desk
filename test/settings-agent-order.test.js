"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  getAgentEventSourceBadgeKey,
  isAgentCollapsible,
  sortAgentMetadataForSettings,
} = require("../src/settings-agent-order");

describe("settings agent order", () => {
  it("maps agent event sources to badge labels", () => {
    assert.strictEqual(getAgentEventSourceBadgeKey({ eventSource: "hook" }), "eventSourceHook");
    assert.strictEqual(getAgentEventSourceBadgeKey({ eventSource: "hook+log-poll" }), "eventSourceHook");
    assert.strictEqual(getAgentEventSourceBadgeKey({ eventSource: "log-poll" }), "eventSourceLogPoll");
    assert.strictEqual(getAgentEventSourceBadgeKey({ eventSource: "plugin-event" }), "eventSourcePlugin");
    assert.strictEqual(getAgentEventSourceBadgeKey({ eventSource: "extension" }), "eventSourceExtension");
  });

  it("treats agents with detail rows as collapsible", () => {
    assert.strictEqual(isAgentCollapsible({ capabilities: { permissionApproval: true } }), true);
    assert.strictEqual(isAgentCollapsible({ capabilities: { interactiveBubble: true } }), true);
    assert.strictEqual(isAgentCollapsible({ capabilities: { notificationHook: true } }), true);
    assert.strictEqual(isAgentCollapsible({ capabilities: { permissionApproval: false, interactiveBubble: false, notificationHook: false } }), false);
    assert.strictEqual(isAgentCollapsible({ capabilities: {} }), false);
    assert.strictEqual(isAgentCollapsible({}), false);
  });

  it("sorts known agents by collapsible group and fixed priority", () => {
    const sorted = sortAgentMetadataForSettings([
      { id: "opencode", name: "OpenCode", capabilities: { permissionApproval: true } },
      { id: "claude-code", name: "Claude Code", capabilities: { permissionApproval: true, notificationHook: true } },
      { id: "codex", name: "Codex CLI", capabilities: { interactiveBubble: true } },
      { id: "pi", name: "Pi", capabilities: {} },
    ]);

    assert.deepStrictEqual(sorted.map((agent) => agent.id), [
      "claude-code",
      "codex",
      "opencode",
      "pi",
    ]);
  });

  it("keeps unknown agents in their group but appends them after known priorities by name", () => {
    const sorted = sortAgentMetadataForSettings([
      { id: "zeta-hook", name: "Zeta Hook", capabilities: { notificationHook: true } },
      { id: "beta-hook", name: "Beta Hook", capabilities: { notificationHook: true } },
      { id: "gamma-cli", name: "Gamma CLI", capabilities: {} },
      { id: "alpha-cli", name: "Alpha CLI", capabilities: {} },
      { id: "claude-code", name: "Claude Code", capabilities: { permissionApproval: true } },
      { id: "pi", name: "Pi", capabilities: {} },
    ]);

    assert.deepStrictEqual(sorted.map((agent) => agent.id), [
      "claude-code",
      "beta-hook",
      "zeta-hook",
      "pi",
      "alpha-cli",
      "gamma-cli",
    ]);
  });

  it("does not mutate the original agent array", () => {
    const agents = [
      { id: "codex", name: "Codex CLI", capabilities: { interactiveBubble: true } },
      { id: "claude-code", name: "Claude Code", capabilities: { permissionApproval: true } },
    ];
    const originalIds = agents.map((agent) => agent.id);

    const sorted = sortAgentMetadataForSettings(agents);

    assert.notStrictEqual(sorted, agents);
    assert.deepStrictEqual(agents.map((agent) => agent.id), originalIds);
  });
});
