"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { getAllAgents } = require("../agents/registry");
const {
  AGENT_METRIC_POLICIES,
  assertRegistryCoverage,
  mapRecapMetrics,
} = require("../src/recap-metrics");

describe("recap metric policies", () => {
  it("explicitly covers every registry agent", () => {
    assert.strictEqual(assertRegistryCoverage(), true);
    assert.deepStrictEqual(
      Object.keys(AGENT_METRIC_POLICIES).sort(),
      getAllAgents().map((agent) => agent.id).sort(),
    );
    for (const policy of Object.values(AGENT_METRIC_POLICIES)) {
      assert.ok(Object.prototype.hasOwnProperty.call(policy, "sessionStart"));
      assert.ok(Object.prototype.hasOwnProperty.call(policy, "turnCompleteEvents"));
      assert.ok(Object.prototype.hasOwnProperty.call(policy, "toolCallEvents"));
    }
  });

  it("counts only explicit fresh Claude-compatible session starts", () => {
    const base = {
      agentId: "claude-code",
      event: "SessionStart",
      sessionStartSource: "startup",
      rawSessionId: "session-1",
    };
    assert.deepStrictEqual(mapRecapMetrics(base), ["activity", "session-start"]);
    assert.deepStrictEqual(mapRecapMetrics({ ...base, sessionStartSource: "resume" }), ["activity"]);
    assert.deepStrictEqual(mapRecapMetrics({ ...base, rawSessionId: "default" }), ["activity"]);
    assert.deepStrictEqual(mapRecapMetrics({ ...base, agentId: "codex" }), ["activity"]);
    assert.strictEqual(AGENT_METRIC_POLICIES.codex.sessionStart, null);
  });

  it("does not claim per-tool support for compacted OpenCode-family streams", () => {
    for (const agentId of ["opencode"]) {
      assert.strictEqual(AGENT_METRIC_POLICIES[agentId].toolCallEvents, null);
      assert.deepStrictEqual(mapRecapMetrics({ agentId, event: "PreToolUse" }), ["activity"]);
    }
  });

  it("counts every explicit Codex tool-start boundary", () => {
    for (const event of [
      "response_item:function_call",
      "response_item:custom_tool_call",
      "response_item:web_search_call",
    ]) {
      assert.deepStrictEqual(mapRecapMetrics({ agentId: "codex", event }), ["activity", "tool-call"]);
    }
  });

  it("requires accepted snapshot completion and excludes subagents", () => {
    assert.deepStrictEqual(mapRecapMetrics({
      agentId: "claude-code",
      event: "Stop",
      completionAccepted: false,
    }), ["activity"]);
    assert.deepStrictEqual(mapRecapMetrics({
      agentId: "claude-code",
      event: "Stop",
      completionAccepted: true,
    }), ["activity", "turn-complete"]);
    assert.deepStrictEqual(mapRecapMetrics({
      agentId: "claude-code",
      event: "Stop",
      completionAccepted: true,
      subagentId: "child-1",
    }), ["activity"]);
    assert.deepStrictEqual(mapRecapMetrics({
      agentId: "codex",
      event: "event_msg:task_complete",
      completionAccepted: true,
      recapIsSubagent: true,
    }), ["activity"]);
  });
});
