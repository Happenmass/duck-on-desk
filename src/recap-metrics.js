"use strict";

const { getAllAgents } = require("../agents/registry");

const STANDARD_TOOL_START = Object.freeze(["PreToolUse"]);
const STANDARD_COMPLETION = Object.freeze(["Stop"]);

// Metric capability is intentionally separate from agents/registry.js
// capabilities. Every registry agent is listed explicitly: new integrations
// must choose a proven boundary or opt out instead of inheriting a guess.
const AGENT_METRIC_POLICIES = Object.freeze({
  "claude-code": policy("fresh-session-source", STANDARD_COMPLETION, STANDARD_TOOL_START),
  codex: policy(null, ["Stop", "event_msg:task_complete"], [
    "PreToolUse",
    "response_item:function_call",
    "response_item:custom_tool_call",
    "response_item:web_search_call",
  ]),
  // OpenCode-family plugins dedupe and compact repeated visual states. A
  // second PreToolUse inside the same working run may never reach /state, so
  // claiming per-tool counts would turn a deterministic undercount into 0.
  opencode: policy(null, STANDARD_COMPLETION, null),
  pi: policy(null, STANDARD_COMPLETION, STANDARD_TOOL_START),
});

function policy(sessionStart, turnCompleteEvents, toolCallEvents) {
  return Object.freeze({
    sessionStart,
    turnCompleteEvents: turnCompleteEvents ? Object.freeze([...turnCompleteEvents]) : null,
    toolCallEvents: toolCallEvents ? Object.freeze([...toolCallEvents]) : null,
  });
}

function hasEvent(events, event) {
  return Array.isArray(events) && events.includes(event);
}

function hasReusableDefaultIdentity(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || normalized === "default" || normalized.endsWith(":default");
}

function getMetricSupport(agentId) {
  const entry = AGENT_METRIC_POLICIES[agentId];
  if (!entry) return null;
  return Object.freeze({
    sessionsStarted: entry.sessionStart !== null && entry.sessionStart !== undefined,
    turnsCompleted: Array.isArray(entry.turnCompleteEvents),
    toolCalls: Array.isArray(entry.toolCallEvents),
  });
}

function mapRecapMetrics(input) {
  if (!input || typeof input !== "object") return null;
  const policyEntry = AGENT_METRIC_POLICIES[input.agentId];
  if (!policyEntry || typeof input.event !== "string" || !input.event) return null;

  const metrics = ["activity"];
  const isSubagent = input.recapIsSubagent === true || !!(input.subagentId || input.subagentType);
  if (
    policyEntry.sessionStart === "fresh-session-source"
    && input.event === "SessionStart"
    && (input.sessionStartSource === "startup" || input.sessionStartSource === "clear")
    && !hasReusableDefaultIdentity(input.rawSessionId)
    && !isSubagent
  ) {
    metrics.push("session-start");
  }
  if (
    input.completionAccepted === true
    && !isSubagent
    && hasEvent(policyEntry.turnCompleteEvents, input.event)
  ) {
    metrics.push("turn-complete");
  }
  if (
    input.recapBoundary !== "permission"
    && hasEvent(policyEntry.toolCallEvents, input.event)
  ) {
    metrics.push("tool-call");
  }
  return metrics;
}

function assertRegistryCoverage() {
  const registryIds = getAllAgents().map((agent) => agent.id).sort();
  const policyIds = Object.keys(AGENT_METRIC_POLICIES).sort();
  if (JSON.stringify(registryIds) !== JSON.stringify(policyIds)) {
    throw new Error("recap metric policies must explicitly cover every registry agent");
  }
  return true;
}

assertRegistryCoverage();

module.exports = {
  AGENT_METRIC_POLICIES,
  assertRegistryCoverage,
  getMetricSupport,
  hasReusableDefaultIdentity,
  mapRecapMetrics,
};
