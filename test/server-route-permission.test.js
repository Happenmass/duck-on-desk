"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const initPermission = require("../src/state/permission");

const {
  DUCK_SERVER_HEADER,
  DUCK_SERVER_ID,
  DUCK_HOOK_PID_HEADER,
  DUCK_PROCESS_INSTANCE_HEADER,
} = require("../hooks/server-config");
const {
  MAX_PERMISSION_BODY_BYTES,
  handlePermissionPost,
  shouldBypassCCBubble,
  shouldBypassCCSubagentBubble,
  shouldBypassCodexBubble,
  shouldBypassFamilyBubble,
} = require("../src/state/server-route-permission");
const {
  INTERACTION_INTENT,
  classifyPermissionInteraction,
  isValidInteraction,
} = require("../src/state/permission-automation-policy");
const { makeSessionKey } = require("../src/state/session-key");

function localSessionKey(rawSessionId) {
  return makeSessionKey({ profileId: "local", rawSessionId });
}

function interaction(agentId, toolName) {
  return classifyPermissionInteraction({ agentId, toolName });
}

function makeReq(body, headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  setImmediate(() => {
    if (body != null) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.headers = {};
  res.body = "";
  res.headersSent = false;
  res.writableFinished = false;
  res.destroyed = false;
  res.writeHead = function writeHead(code, headers) {
    this.statusCode = code;
    this.headersSent = true;
    if (headers) this.headers = headers;
  };
  res.end = function end(data) {
    if (data) this.body += String(data);
    this.writableFinished = true;
  };
  res.destroy = function destroy() {
    this.destroyed = true;
    this.emit("close");
  };
  return res;
}

function makeCtx(overrides = {}) {
  const calls = {
    logs: [],
    updateSession: [],
    showPermissionBubble: [],
    sendPermissionResponse: [],
    replyOpencodeFamilyPermission: [],
    dismissOpencodeFamilyPermissionResolvedExternally: [],
    resolved: [],
    addPendingPermission: [],
    removePendingPermission: [],
  };
  const ctx = {
    doNotDisturb: false,
    hideBubbles: false,
    pendingPermissions: [],
    sessions: new Map(),
    PASSTHROUGH_TOOLS: new Set(),
    permLog: (message) => calls.logs.push(message),
    isAgentEnabled: () => true,
    isAgentPermissionsEnabled: () => true,
    isAgentSubagentPermissionsEnabled: () => true,
    updateSession: (...args) => calls.updateSession.push(args),
    showPermissionBubble: (entry) => calls.showPermissionBubble.push(entry),
    sendPermissionResponse: (res, behavior, message) => {
      calls.sendPermissionResponse.push({ behavior, message });
      res.writeHead(200);
      res.end(behavior);
    },
    replyOpencodeFamilyPermission: (payload) => calls.replyOpencodeFamilyPermission.push(payload),
    dismissOpencodeFamilyPermissionResolvedExternally: (payload) => {
      calls.dismissOpencodeFamilyPermissionResolvedExternally.push(payload);
      return 0;
    },
    resolvePermissionEntry: (entry, behavior, message) => calls.resolved.push({ entry, behavior, message }),
    addPendingPermission(entry) {
      calls.addPendingPermission.push(entry);
      this.pendingPermissions.push(entry);
      return entry;
    },
    removePendingPermission(entry, reason) {
      calls.removePendingPermission.push({ entry, reason });
      const idx = this.pendingPermissions.indexOf(entry);
      if (idx === -1) return false;
      this.pendingPermissions.splice(idx, 1);
      return true;
    },
    ...overrides,
  };
  ctx.calls = calls;
  return ctx;
}

function callPermissionPost(body, overrides = {}) {
  return new Promise((resolve) => {
    const res = makeRes();
    const ctx = makeCtx(overrides.ctx);
    const recorder = [];
    handlePermissionPost(makeReq(body, overrides.headers), res, {
      ctx,
      createRequestHookRecorder: (identity, data, route) => {
        recorder.push({ identity, data, route });
        return {
          accepted: () => recorder.push({ outcome: "accepted" }),
          droppedByDisabled: () => recorder.push({ outcome: "disabled" }),
          droppedByDnd: () => recorder.push({ outcome: "dnd" }),
          droppedInvalidAgent: () => recorder.push({ outcome: "invalid-agent" }),
          droppedUnsupported: () => recorder.push({ outcome: "unsupported" }),
        };
      },
      ...overrides.options,
    });
    setImmediate(() => {
      setImmediate(() => {
        res.ctx = ctx;
        res.recorder = recorder;
        resolve(res);
      });
    });
  });
}

function callPermissionPostThroughAutomation(body, mode, options = {}) {
  return new Promise((resolve) => {
    const res = makeRes();
    const ctx = makeCtx({
      focusTerminalForSession() {},
      getSettingsSnapshot: () => ({}),
      getPermissionAutomationMode: () => mode,
      getBubblePolicy: () => ({ enabled: true, autoCloseMs: 0 }),
      getPetWindowBounds: () => null,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      getHitRectScreen: () => null,
      getHudReservedOffset: () => 0,
      guardAlwaysOnTop() {},
      reapplyMacVisibility() {},
      repositionUpdateBubble() {},
      subscribeShortcuts: () => () => {},
      reportShortcutFailure() {},
      clearShortcutFailure() {},
      win: null,
      bubbleFollowPet: false,
      petHidden: false,
    });
    const permission = initPermission(ctx);
    Object.assign(ctx, {
      pendingPermissions: permission.pendingPermissions,
      PASSTHROUGH_TOOLS: permission.PASSTHROUGH_TOOLS,
      addPendingPermission: permission.addPendingPermission,
      removePendingPermission: permission.removePendingPermission,
      showPermissionBubble: options.showPermissionBubble || permission.showPermissionBubble,
      resolvePermissionEntry: permission.resolvePermissionEntry,
      sendPermissionResponse: permission.sendPermissionResponse,
      syncPermissionShortcuts: permission.syncPermissionShortcuts,
    });
    const recorder = [];
    handlePermissionPost(makeReq(body), res, {
      ctx,
      createRequestHookRecorder: (identity, data, route) => {
        recorder.push({ identity, data, route });
        return {
          accepted: () => recorder.push({ outcome: "accepted" }),
          droppedByDisabled: () => recorder.push({ outcome: "disabled" }),
          droppedByDnd: () => recorder.push({ outcome: "dnd" }),
          droppedInvalidAgent: () => recorder.push({ outcome: "invalid-agent" }),
          droppedUnsupported: () => recorder.push({ outcome: "unsupported" }),
        };
      },
    });
    setImmediate(() => {
      setImmediate(() => {
        res.ctx = ctx;
        res.permission = permission;
        res.recorder = recorder;
        resolve(res);
      });
    });
  });
}

describe("Claude ExitPlanMode updatedInput compatibility", () => {
  it("keeps the exact request input separate from the truncated display copy", async () => {
    const rawInput = {
      plan: `Start of plan ${"x".repeat(700)} end-of-plan`,
      planFilePath: "C:\\Users\\Ruller\\.claude\\plans\\exact.md",
      metadata: { source: "permission-hook", untouched: true },
      steps: ["first", "second"],
    };
    const res = await callPermissionPostThroughAutomation(JSON.stringify({
      agent_id: "claude-code",
      session_id: "claude:exact-plan-input",
      tool_name: "ExitPlanMode",
      tool_input: rawInput,
    }), "off", { showPermissionBubble() {} });

    assert.strictEqual(res.permission.pendingPermissions.length, 1);
    const entry = res.permission.pendingPermissions[0];
    assert.notStrictEqual(entry.toolInput.plan, rawInput.plan, "display copy should remain truncated");
    assert.deepStrictEqual(entry.planReviewWireInput, rawInput, "wire input must remain unmodified");

    res.permission.resolvePermissionEntry(entry, "allow");

    assert.strictEqual(res.body, JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
          updatedInput: rawInput,
        },
      },
    }));
  });

  it("drops the connection instead of allowing when the request omitted tool_input", async () => {
    const res = await callPermissionPostThroughAutomation(JSON.stringify({
      agent_id: "claude-code",
      session_id: "claude:missing-plan-input",
      tool_name: "ExitPlanMode",
    }), "off", { showPermissionBubble() {} });

    assert.strictEqual(res.permission.pendingPermissions.length, 1);
    const entry = res.permission.pendingPermissions[0];
    assert.strictEqual(entry.planReviewWireInput, null);

    res.permission.resolvePermissionEntry(entry, "allow");

    assert.strictEqual(res.body, "", "fallback must not write a decision payload");
    assert.strictEqual(res.writableFinished, false, "fallback must not end with a false allow");
    assert.strictEqual(res.destroyed, true, "connection drop returns control to Claude's native prompt");
    assert.deepStrictEqual(res.permission.pendingPermissions, []);
  });
});

describe("server-route-permission helpers", () => {
  it("preserves bubble bypass decisions for CC, Codex, and opencode", () => {
    assert.strictEqual(shouldBypassCCBubble({ hideBubbles: true }, interaction("claude-code", "Bash"), "claude-code"), true);
    assert.strictEqual(shouldBypassCCBubble({ hideBubbles: true }, interaction("claude-code", "ExitPlanMode"), "claude-code"), false);
    assert.strictEqual(shouldBypassCCBubble({ hideBubbles: true }, interaction("claude-code", "AskUserQuestion"), "claude-code"), false);
    assert.strictEqual(shouldBypassCodexBubble({ hideBubbles: true }), true);
    assert.strictEqual(shouldBypassCodexBubble({
      isAgentPermissionsEnabled: (agentId) => agentId !== "codex",
    }), true);
    assert.strictEqual(shouldBypassFamilyBubble({
      isAgentPermissionsEnabled: (agentId) => agentId !== "opencode",
    }, "opencode"), true);
  });

  it("bypasses CC subagent bubbles only for subagent-origin requests with the sub-gate off", () => {
    const gateOff = { isAgentSubagentPermissionsEnabled: () => false };
    const gateOn = { isAgentSubagentPermissionsEnabled: () => true };
    const subagent = { source: "subagent", subagentId: "uuid-1", subagentType: "Explore" };
    const mainThread = { source: "explicit" };

    assert.strictEqual(shouldBypassCCSubagentBubble(gateOff, interaction("claude-code", "Bash"), "claude-code", subagent), true);
    assert.strictEqual(shouldBypassCCSubagentBubble(gateOn, interaction("claude-code", "Bash"), "claude-code", subagent), false);
    assert.strictEqual(shouldBypassCCSubagentBubble(gateOff, interaction("claude-code", "Bash"), "claude-code", mainThread), false);
    // UX flows stay exempt, mirroring shouldBypassCCBubble.
    assert.strictEqual(shouldBypassCCSubagentBubble(gateOff, interaction("claude-code", "ExitPlanMode"), "claude-code", subagent), false);
    assert.strictEqual(shouldBypassCCSubagentBubble(gateOff, interaction("claude-code", "AskUserQuestion"), "claude-code", subagent), false);
    // Missing gate reader (older ctx) keeps current behavior: bubble.
    assert.strictEqual(shouldBypassCCSubagentBubble({}, interaction("claude-code", "Bash"), "claude-code", subagent), false);
  });

});

describe("server-route-permission POST", () => {
  it("stamps a valid tool-approval interaction on every entry-producing adapter", async () => {
    const cases = [
      { agentId: "claude-code", body: {} },
      { agentId: "codex", body: {} },
      {
        agentId: "opencode",
        body: {
          request_id: "req-stamp",
          bridge_url: "http://127.0.0.1:9",
          bridge_token: "stamp-token",
        },
      },
    ];

    for (const { agentId, body } of cases) {
      const res = await callPermissionPost(JSON.stringify({
        agent_id: agentId,
        session_id: `${agentId}:stamp`,
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        ...body,
      }));
      assert.strictEqual(res.ctx.pendingPermissions.length, 1, agentId);
      const entry = res.ctx.pendingPermissions[0];
      assert.strictEqual(isValidInteraction(entry.interaction), true, agentId);
      assert.strictEqual(entry.interaction.intent, INTERACTION_INTENT.TOOL_APPROVAL, agentId);
      assert.strictEqual(entry.sessionAutomationIdentity.eligible, false, agentId);
      assert.strictEqual(Object.isFrozen(entry.sessionAutomationIdentity), true, agentId);
      assert.deepStrictEqual(
        res.ctx.calls.updateSession.at(-1)[3].sessionAutomationIdentity,
        entry.sessionAutomationIdentity,
        `${agentId} permission identity must reach the main-owned session path`
      );
    }
  });

  it("keeps a bounded compact preview and a complete local detail across permission adapters", async () => {
    const marker = "__DUCK_PERMISSION_DETAIL_END__";
    const command = `${"printf x; ".repeat(260)}${marker}`;
    const cases = [
      { agentId: "claude-code", body: {} },
      { agentId: "codex", body: { tool_input_description: "Run a generated command" } },
      {
        agentId: "opencode",
        body: {
          request_id: "req-detail",
          bridge_url: "http://127.0.0.1:9",
          bridge_token: "detail-token",
        },
      },
    ];

    for (const { agentId, body } of cases) {
      const res = await callPermissionPost(JSON.stringify({
        agent_id: agentId,
        session_id: `${agentId}:detail`,
        tool_name: "Bash",
        tool_input: { command },
        ...body,
      }));
      assert.strictEqual(res.ctx.pendingPermissions.length, 1, agentId);
      const entry = res.ctx.pendingPermissions[0];
      assert.strictEqual(entry.detailText.endsWith(marker), true, agentId);
      assert.strictEqual(entry.detailTruncated, false, agentId);
      assert.strictEqual(JSON.stringify(entry.toolInput).includes(marker), false, agentId);
    }
  });

  it("keeps long Ask text for the expanded view without changing the wire answer keys", async () => {
    const marker = "__DUCK_ASK_DETAIL_END__";
    const question = [
      "Compare the tradeoffs carefully.",
      "",
      "1. Keep the compact window.",
      "2. Open a scrollable detail view.",
      "",
      `${"Include every relevant constraint. ".repeat(20)}${marker}`,
    ].join("\n");
    const optionDescription = [
      "Open the detail view.",
      "",
      "- Preserve paragraphs.",
      "- Preserve list structure.",
    ].join("\n");
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "claude-code:ask-detail",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question,
          header: "Approach",
          multiSelect: false,
          options: [
            { label: "Option A", description: "Keep the compact window." },
            { label: "Option B", description: optionDescription },
          ],
        }],
      },
    }));

    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.toolInput.questions[0].question.includes(marker), false);
    assert.strictEqual(entry.elicitationDetailInput.questions[0].question, question);
    assert.strictEqual(entry.elicitationDetailInput.questions[0].options[1].description, optionDescription);
    assert.strictEqual(entry.elicitationWireInput.questions[0].question, question);
  });

  it("uses the raw permission session id and ignores sender eligibility claims", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "default",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      sessionAutomationEligible: true,
    }));

    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    assert.deepStrictEqual(
      res.ctx.pendingPermissions[0].sessionAutomationIdentity,
      { eligible: false, reason: "placeholder-session-id" }
    );
    assert.deepStrictEqual(
      res.ctx.calls.updateSession[0][3].sessionAutomationIdentity,
      { eligible: false, reason: "placeholder-session-id" }
    );
  });

  it("runs an unreviewed non-empty Claude tool through unattended compatibility without weakening auto-tools", async () => {
    const body = JSON.stringify({
      agent_id: "claude-code",
      session_id: "claude:new-tool",
      tool_name: "FutureBuiltinTool",
      tool_input: { action: "run" },
    });
    const unattended = await callPermissionPostThroughAutomation(body, "unattended");
    assert.strictEqual(unattended.statusCode, 200);
    assert.strictEqual(
      JSON.parse(unattended.body).hookSpecificOutput.decision.behavior,
      "allow"
    );
    assert.strictEqual(unattended.permission.pendingPermissions.length, 0);

    const autoTools = await callPermissionPostThroughAutomation(body, "auto-tools", {
      // Exercise the successful DEFER lifecycle without constructing an
      // Electron BrowserWindow in the pure Node route test.
      showPermissionBubble() {},
    });
    assert.strictEqual(autoTools.statusCode, null);
    assert.strictEqual(autoTools.body, "");
    assert.strictEqual(autoTools.writableFinished, false);
    assert.strictEqual(autoTools.destroyed, false);
    assert.strictEqual(autoTools.permission.pendingPermissions.length, 1);
  });

  it("normalizes unattended Claude question aliases before generating the wire response", async () => {
    for (const toolName of ["askuserquestion", "AskUserQuestionTool"]) {
      const res = await callPermissionPostThroughAutomation(JSON.stringify({
        agent_id: "claude-code",
        session_id: `claude:${toolName}`,
        tool_name: toolName,
        tool_input: {
          questions: [{
            question: "Which approach?",
            options: [{ label: "A" }, { label: "B" }],
          }],
        },
      }), "unattended");

      assert.strictEqual(res.statusCode, 200, toolName);
      assert.strictEqual(res.destroyed, false, toolName);
      assert.strictEqual(res.permission.pendingPermissions.length, 0, toolName);
      const decision = JSON.parse(res.body).hookSpecificOutput.decision;
      assert.strictEqual(decision.behavior, "allow", toolName);
      assert.deepStrictEqual(
        decision.updatedInput.answers,
        {
          "Which approach?": "You choose whatever is best.",
        },
        toolName
      );
      assert.deepStrictEqual(
        decision.updatedInput.questions,
        [{
          question: "Which approach?",
          options: [{ label: "A" }, { label: "B" }],
        }],
        toolName
      );
    }
  });

  it("releases a deferred decision entry when the blocking hook client disconnects", async () => {
    const res = await callPermissionPostThroughAutomation(JSON.stringify({
      agent_id: "claude-code",
      session_id: "claude:disconnect-question",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{
          question: "Continue?",
          options: [{ label: "Yes" }, { label: "No" }],
        }],
      },
    }), "auto-tools", {
      // Keep the real entry/resolver lifecycle while avoiding an Electron
      // window in this route-level integration test.
      showPermissionBubble() {},
    });

    assert.strictEqual(res.permission.pendingPermissions.length, 1);
    res.emit("close");
    assert.strictEqual(res.permission.pendingPermissions.length, 0);
    assert.strictEqual(res.destroyed, true);
    assert.strictEqual(res.body, "");
  });

  it("stamps questions conservatively and treats unverified plan-name collisions as unknown", async () => {
    const cases = [
      { agentId: "codex", toolName: "AskUserQuestion", intent: INTERACTION_INTENT.HUMAN_QUESTION },
      {
        agentId: "opencode",
        toolName: "ExitPlanMode",
        intent: INTERACTION_INTENT.UNKNOWN,
        extra: {
          request_id: "req-decision-stamp",
          bridge_url: "http://127.0.0.1:9",
          bridge_token: "stamp-token",
        },
      },
    ];

    for (const { agentId, toolName, intent, extra = {} } of cases) {
      const toolInput = intent === INTERACTION_INTENT.HUMAN_QUESTION
        ? { questions: [{ question: "Continue?" }] }
        : { plan: "ship it" };
      const res = await callPermissionPost(JSON.stringify({
        agent_id: agentId,
        session_id: `${agentId}:decision-stamp`,
        tool_name: toolName,
        tool_input: toolInput,
        ...extra,
      }));
      assert.strictEqual(res.ctx.pendingPermissions.length, 1, `${agentId}:${toolName}`);
      const entry = res.ctx.pendingPermissions[0];
      assert.strictEqual(isValidInteraction(entry.interaction), true, `${agentId}:${toolName}`);
      assert.strictEqual(entry.interaction.intent, intent, `${agentId}:${toolName}`);
      assert.strictEqual(entry.interaction.capabilities.answerQuestions, false, agentId);
      assert.strictEqual(entry.interaction.capabilities.planFeedback, false, agentId);
    }
  });

  it("keeps identical remote raw ids in separate permission queues with trusted profile metadata", async () => {
    const body = JSON.stringify({
      agent_id: "claude-code",
      session_id: "same-raw",
      host: "spoofed-by-hook",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    const postFor = (profileId) => callPermissionPost(body, {
      options: {
        remoteProfile: {
          profileId,
          displayHost: "same-display-host",
        },
      },
    });
    const [a, b] = await Promise.all([postFor("profile-a"), postFor("profile-b")]);
    const aId = makeSessionKey({ profileId: "profile-a", rawSessionId: "same-raw" });
    const bId = makeSessionKey({ profileId: "profile-b", rawSessionId: "same-raw" });
    assert.strictEqual(a.ctx.pendingPermissions[0].sessionId, aId);
    assert.strictEqual(b.ctx.pendingPermissions[0].sessionId, bId);
    assert.notStrictEqual(a.ctx.pendingPermissions[0].sessionId, b.ctx.pendingPermissions[0].sessionId);
    assert.deepStrictEqual({
      profileId: a.ctx.pendingPermissions[0].profileId,
      rawSessionId: a.ctx.pendingPermissions[0].rawSessionId,
      host: a.ctx.pendingPermissions[0].host,
    }, {
      profileId: "profile-a",
      rawSessionId: "same-raw",
      host: "same-display-host",
    });
    assert.deepStrictEqual(a.ctx.calls.updateSession[0].slice(0, 3), [
      aId, "notification", "PermissionRequest",
    ]);
    assert.deepStrictEqual(b.ctx.calls.updateSession[0].slice(0, 3), [
      bId, "notification", "PermissionRequest",
    ]);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await callPermissionPost("{not json");

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body, "bad json");
    assert.strictEqual(res.recorder.length, 0);
  });

  it("never forges a deny for oversized permission bodies (connection closed, native fallback)", async () => {
    const res = await callPermissionPost("x".repeat(MAX_PERMISSION_BODY_BYTES + 1));

    // A transport-level rejection happens before the agent is identified, so
    // the only safe answer is no answer: destroy the socket so Claude Code
    // falls back to its chat prompt.
    assert.deepStrictEqual(res.ctx.calls.sendPermissionResponse, []);
    assert.strictEqual(res.destroyed, true);
  });

  it("returns no-decision for Codex DND fallback", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "codex",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: { doNotDisturb: true },
    });

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["dnd"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
  });

  it("passes Codex Desktop focus metadata through permission bubbles", async () => {
    const sessionId = "codex:019e115a-4df2-7ed0-b90e-8e6345aca777";
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "codex",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      source_pid: 456,
      agent_pid: 456,
      pid_chain: [789, 456, -1],
      tmux_socket: "/tmp/tmux-1000/work",
      tmux_client: "/dev/pts/7",
      orca_pane_key: "8ce1fff7-tab:9813824b-leaf",
      cwd: "/repo",
      platform: "webui",
      model: "gpt-5.4",
      codex_originator: "Codex Desktop",
      codex_source: "vscode",
      hook_source: "codex-official",
    }));

    assert.strictEqual(res.statusCode, null);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.sessionId, localSessionKey(sessionId));
    assert.strictEqual(entry.agentId, "codex");
    assert.strictEqual(entry.isCodex, true);
    assert.strictEqual(entry.sourcePid, 456);
    assert.strictEqual(entry.agentPid, 456);
    assert.deepStrictEqual(entry.pidChain, [789, 456]);
    assert.strictEqual(entry.tmuxSocket, "/tmp/tmux-1000/work");
    assert.strictEqual(entry.tmuxClient, "/dev/pts/7");
    assert.strictEqual(entry.orcaPaneKey, "8ce1fff7-tab:9813824b-leaf");
    assert.strictEqual(entry.cwd, "/repo");
    assert.strictEqual(entry.platform, "webui");
    assert.strictEqual(entry.model, "gpt-5.4");
    assert.strictEqual(entry.codexOriginator, "Codex Desktop");
    assert.strictEqual(entry.codexSource, "vscode");
    assert.deepStrictEqual(res.ctx.calls.updateSession, [[
      localSessionKey(sessionId),
      "notification",
      "PermissionRequest",
      {
        agentId: "codex",
        hookSource: "codex-official",
        sourcePid: 456,
        agentPid: 456,
        pidChain: [789, 456],
        tmuxSocket: "/tmp/tmux-1000/work",
        tmuxClient: "/dev/pts/7",
        orcaPaneKey: "8ce1fff7-tab:9813824b-leaf",
        cwd: "/repo",
        platform: "webui",
        model: "gpt-5.4",
        codexOriginator: "Codex Desktop",
        codexSource: "vscode",
        profileId: "local",
        rawSessionId: sessionId,
        sessionAutomationIdentity: {
          eligible: false,
          reason: "unsupported-codex-session-source",
        },
      },
    ]]);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, [entry]);
    assert.deepStrictEqual(res.ctx.calls.addPendingPermission, [entry]);
  });

  it("returns no-decision for headless Codex sessions before auto-pilot can allow", async () => {
    const sessionId = "codex:headless-subagent";
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "codex",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: {
        sessions: new Map([[localSessionKey(sessionId), { agentId: "codex", headless: true }]]),
      },
    });

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["accepted"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.addPendingPermission, []);
  });

  it("silently drops disabled opencode permissions after ACK", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      tool_name: "Bash",
      request_id: "req-1",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    }), {
      ctx: {
        isAgentEnabled: (agentId) => agentId !== "opencode",
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, "ok");
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["disabled"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.replyOpencodeFamilyPermission, []);
  });

  it("routes opencode permissions by hook_source when agent_id is missing", async () => {
    const res = await callPermissionPost(JSON.stringify({
      hook_source: "opencode-plugin",
      session_id: "opencode:s1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      request_id: "req-1",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    }));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, "ok");
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.agentId, "opencode");
    assert.strictEqual(entry.familyRequestId, "req-1");
    assert.deepStrictEqual(res.ctx.calls.updateSession, [[
      localSessionKey("opencode:s1"),
      "notification",
      "PermissionRequest",
      {
        agentId: "opencode",
        profileId: "local",
        rawSessionId: "opencode:s1",
        sessionAutomationIdentity: {
          eligible: false,
          reason: "permission-session-association-not-authoritative",
        },
      },
    ]]);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["accepted"]);
  });

  it("keeps an opencode permission with a missing tool name manually actionable but never automatable", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      session_id: "opencode:unknown",
      tool_input: { command: "custom action" },
      request_id: "req-unknown",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    }));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.toolName, "unknown");
    assert.strictEqual(entry.interaction.intent, INTERACTION_INTENT.UNKNOWN);
    assert.strictEqual(entry.interaction.capabilities.allowDeny, true);
    assert.deepStrictEqual(
      { ...entry.interaction.automationEligibility },
      { autoTools: false, unattended: false }
    );
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, [entry]);
  });

  it("rejects non-loopback or path-bearing opencode bridges before enqueue", async () => {
    for (const bridgeUrl of [
      "https://127.0.0.1:1234",
      "http://localhost:1234",
      "http://127.0.0.1:1234/reply",
      "http://192.168.1.20:1234",
      "http://example.com:1234",
    ]) {
      const res = await callPermissionPost(JSON.stringify({
        agent_id: "opencode",
        session_id: "opencode:invalid-bridge",
        tool_name: "Bash",
        request_id: "req-invalid-bridge",
        bridge_url: bridgeUrl,
        bridge_token: "token",
      }));
      assert.strictEqual(res.statusCode, 200, bridgeUrl);
      assert.deepStrictEqual(res.ctx.pendingPermissions, [], bridgeUrl);
      assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, [], bridgeUrl);
      assert.deepStrictEqual(res.ctx.calls.replyOpencodeFamilyPermission, [], bridgeUrl);
    }
  });

  it("silently drops headless opencode sessions before auto-pilot can bridge allow", async () => {
    const sessionId = "opencode:headless";
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      hook_source: "codex-official",
      codex_session_role: "subagent",
      codex_originator: "codex-tui",
      session_id: sessionId,
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      request_id: "req-headless",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    }), {
      ctx: {
        sessions: new Map([[localSessionKey(sessionId), { agentId: "opencode", headless: true }]]),
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, "ok");
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["accepted"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.replyOpencodeFamilyPermission, []);
  });

  it("silently drops opencode permissions during DND — no bubble, no bridge reply", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      session_id: "opencode:dnd",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      request_id: "req-dnd",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    }), {
      ctx: { doNotDisturb: true },
    });

    // Fire-and-forget: 200 ACK satisfies the plugin; skipping the bridge
    // reply lets the TUI fall back to its own prompt.
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, "ok");
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["dnd"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.replyOpencodeFamilyPermission, []);
  });

  it("rescues a failed opencode bubble with an immediate bridge reject", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      session_id: "opencode:boom",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      request_id: "req-boom",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    }), {
      ctx: {
        showPermissionBubble: () => { throw new Error("BrowserWindow boom"); },
      },
    });

    assert.strictEqual(res.statusCode, 200);
    // Ghost entry popped, TUI unblocked via reject — without this the plugin
    // waits on the bridge until its own multi-minute timeout.
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.strictEqual(res.ctx.calls.replyOpencodeFamilyPermission.length, 1);
    const reply = res.ctx.calls.replyOpencodeFamilyPermission[0];
    assert.strictEqual(reply.agentId, "opencode");
    assert.strictEqual(reply.reply, "reject");
    assert.strictEqual(reply.requestId, "req-boom");
    assert.strictEqual(reply.bridgeUrl, "http://127.0.0.1:1234");
    assert.strictEqual(reply.bridgeToken, "token");
  });

  it("routes a strict family replied lifecycle before every create/decision gate and never records a request", async () => {
    const lifecycleCalls = [];
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      hook_source: "opencode-plugin",
      permission_event: "replied",
      session_id: "opencode:ses-life",
      request_id: "per-life",
      lifecycle_bridge_url: "http://127.0.0.1:43210",
      lifecycle_bridge_token: "token_life",
    }), {
      ctx: {
        doNotDisturb: true,
        hideBubbles: true,
        isAgentEnabled: () => false,
        isAgentPermissionsEnabled: () => false,
        dismissOpencodeFamilyPermissionResolvedExternally: (identity) => {
          lifecycleCalls.push(identity);
          return 1;
        },
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
    assert.strictEqual(res.body, "ok");
    assert.deepStrictEqual(lifecycleCalls, [{
      agentId: "opencode",
      requestId: "per-life",
      sessionId: localSessionKey("opencode:ses-life"),
      bridgeUrl: "http://127.0.0.1:43210",
      bridgeToken: "token_life",
    }]);
    assert.deepStrictEqual(res.recorder, [], "lifecycle must not create a PermissionRequest recorder");
    assert.deepStrictEqual(res.ctx.calls.updateSession, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.addPendingPermission, []);
    assert.deepStrictEqual(res.ctx.calls.replyOpencodeFamilyPermission, []);
  });

  it("200-no-ops malformed lifecycle identity without a default session or a thrown validator error", async () => {
    const invalidBodies = [
      { session_id: null },
      { session_id: 42 },
      { lifecycle_bridge_url: "http://localhost:43210" },
      { lifecycle_bridge_url: { href: "http://127.0.0.1:43210" } },
      { lifecycle_bridge_token: 42 },
      { lifecycle_bridge_token: "x".repeat(129) },
      { request_id: "" },
    ];
    for (const delta of invalidBodies) {
      const res = await callPermissionPost(JSON.stringify({
        agent_id: "opencode",
        permission_event: "replied",
        session_id: "opencode:strict",
        request_id: "per-strict",
        lifecycle_bridge_url: "http://127.0.0.1:43210",
        lifecycle_bridge_token: "token_strict",
        ...delta,
      }));
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
      assert.deepStrictEqual(res.recorder, []);
      assert.deepStrictEqual(
        res.ctx.calls.dismissOpencodeFamilyPermissionResolvedExternally,
        [],
        JSON.stringify(delta)
      );
      assert.deepStrictEqual(res.ctx.pendingPermissions, []);
      assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    }
  });

  it("fails closed for unknown permission_event instead of creating an unknown family bubble", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "opencode",
      permission_event: "resolved-someday",
      session_id: "opencode:unknown-event",
      request_id: "per-unknown-event",
      lifecycle_bridge_url: "http://127.0.0.1:1234",
      lifecycle_bridge_token: "token-unknown-event",
    }));

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.recorder, []);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.dismissOpencodeFamilyPermissionResolvedExternally, []);
  });

  it("keeps ACK and ordinary family enqueue in one synchronous execution segment", () => {
    const body = JSON.stringify({
      agent_id: "opencode",
      session_id: "opencode:sync",
      tool_name: "Bash",
      request_id: "per-sync",
      bridge_url: "http://127.0.0.1:1234",
      bridge_token: "token",
    });
    const ctx = makeCtx();
    let dataHandler = null;
    const req = {
      headers: {},
      on(eventName, handler) {
        if (eventName === "data") dataHandler = handler;
        if (eventName === "end") {
          dataHandler(Buffer.from(body));
          handler();
        }
        return this;
      },
    };
    const res = makeRes();
    let pendingAtAck = null;
    const originalEnd = res.end;
    res.end = function endAndSnapshot(data) {
      originalEnd.call(this, data);
      pendingAtAck = ctx.pendingPermissions.length;
    };

    handlePermissionPost(req, res, {
      ctx,
      createRequestHookRecorder: () => ({
        accepted() {}, droppedByDisabled() {}, droppedByDnd() {},
        droppedInvalidAgent() {}, droppedUnsupported() {},
      }),
    });

    assert.strictEqual(pendingAtAck, 0, "ACK is written immediately before enqueue");
    assert.strictEqual(ctx.pendingPermissions.length, 1, "enqueue completes before the handler returns");
    assert.strictEqual(ctx.pendingPermissions[0].familyRequestId, "per-sync");
  });

  it("destroys the Claude connection during DND", async () => {
    const res = await callPermissionPost(JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: { doNotDisturb: true },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["dnd"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
  });

  it("allows legacy Pi permission requests during DND to preserve Pi YOLO behavior", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "pi",
      session_id: "pi:sid",
      tool_name: "bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: { doNotDisturb: true },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
    assert.strictEqual(JSON.parse(res.body).hookSpecificOutput.decision.behavior, "allow");
    assert.deepStrictEqual(res.recorder.map((entry) => entry.outcome).filter(Boolean), ["dnd"]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
  });

  it("allows legacy Pi permission requests without creating a bubble", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "pi",
      session_id: "pi:sid",
      tool_name: "write",
      tool_input: { path: "out.txt", content: "x" },
      tool_use_id: "tool-1",
    }));

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
    assert.strictEqual(JSON.parse(res.body).hookSpecificOutput.decision.behavior, "allow");
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.updateSession, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.addPendingPermission, []);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["accepted"]);
  });

  it("allows legacy Pi permission requests when the Pi agent is disabled", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "pi",
      session_id: "pi:sid",
      tool_name: "edit",
      tool_input: { path: "a.txt" },
    }), {
      ctx: {
        isAgentEnabled: (agentId) => agentId !== "pi",
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers[DUCK_SERVER_HEADER], DUCK_SERVER_ID);
    assert.strictEqual(JSON.parse(res.body).hookSpecificOutput.decision.behavior, "allow");
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["disabled"]);
  });

  it("pushes a normal Claude permission entry and shows the bubble", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_use_id: "tool-1",
    }));

    assert.strictEqual(res.statusCode, null);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.res, res);
    assert.strictEqual(entry.sessionId, localSessionKey("sid"));
    assert.strictEqual(entry.profileId, "local");
    assert.strictEqual(entry.rawSessionId, "sid");
    assert.strictEqual(entry.toolName, "Bash");
    assert.strictEqual(entry.toolUseId, "tool-1");
    assert.strictEqual(entry.agentId, "claude-code");
    assert.deepStrictEqual(res.ctx.calls.updateSession, [[
      localSessionKey("sid"),
      "notification",
      "PermissionRequest",
      {
        agentId: "claude-code",
        profileId: "local",
        rawSessionId: "sid",
        sessionAutomationIdentity: {
          eligible: false,
          reason: "identity-verification-required",
        },
      },
    ]]);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, [entry]);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["accepted"]);
  });

  it("returns no-decision for a currently registered state-only custom AI", async () => {
    const id = "custom-nova-ai-0123456789ab";
    const res = await callPermissionPost(JSON.stringify({
      agent_id: id,
      session_id: "nova:sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_use_id: "tool-custom-1",
    }), { ctx: { getCustomAgentIds: () => [id] } });
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.ctx.pendingPermissions.length, 0);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["unsupported"]);
  });

  it("rejects stale custom ids without creating a Claude permission bubble", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "custom-stale-0123456789ab",
      hook_source: "duck-hook",
      session_id: "stale:sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }));

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.ctx.pendingPermissions.length, 0);
    assert.strictEqual(res.ctx.calls.showPermissionBubble.length, 0);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["invalid-agent"]);
  });

  it("rejects an invalid overlong Claude subagent id instead of creating an unmatchable entry", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "x".repeat(257),
      session_id: "sid-overlong-subagent",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }));

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.ctx.pendingPermissions.length, 0);
    assert.strictEqual(res.ctx.calls.showPermissionBubble.length, 0);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["invalid-agent"]);
  });

  it("destroys the connection when a Claude bubble fails", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: {
        showPermissionBubble: () => {
          throw new Error("no window");
        },
      },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.removePendingPermission.map((item) => item.reason), ["bubble-failed"]);
  });

  it("destroys the connection when permission bubbles are disabled", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: {
        hideBubbles: true,
      },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    // No card went out, so the pet must not play the PermissionRequest
    // notification animation — there is nothing for the user to act on.
    assert.deepStrictEqual(res.ctx.calls.updateSession, []);
  });

  it("keeps the per-agent gate authoritative when both permission toggles are off", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: {
        hideBubbles: true,
        // Stronger opt-out: the user disabled permission handling for this
        // agent entirely.
        isAgentPermissionsEnabled: () => false,
      },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.ctx.calls.updateSession, []);
  });

  it("returns terminal fallback when an elicitation bubble fails", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "sid",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Continue?" }] },
    }), {
      ctx: {
        showPermissionBubble: () => {
          throw new Error("no window");
        },
      },
    });

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.sendPermissionResponse, [{
      behavior: "deny",
      message: "Elicitation bubble unavailable; answer in terminal",
    }]);
  });

});

// ── Claude Code subagent requests (#451) ──
// CC ≥ 2.1.x stamps PermissionRequest hook input with agent_id (per-instance
// subagent uuid) + agent_type when the request fires from inside a Task
// subagent. resolveHookAgentId normalizes that to claude-code, and the
// per-agent subagent sub-gate decides whether to bubble or drop the
// connection (CC terminal fallback).
describe("server-route-permission Windows B1a Codex metadata", () => {
  const generation = "permission-route-generation";
  const headers = {
    [DUCK_HOOK_PID_HEADER.toLowerCase()]: "7654",
    [DUCK_PROCESS_INSTANCE_HEADER.toLowerCase()]: generation,
  };
  const runtime = (mode) => ({
    version: 1,
    instanceGeneration: generation,
    agents: { codex: mode },
  });
  const body = (extra = {}) => JSON.stringify({
    agent_id: "codex",
    hook_source: "codex-official",
    hook_event_name: "PermissionRequest",
    session_id: "codex:b1a-permission",
    tool_name: "Shell",
    tool_input: { command: "echo ok" },
    source_pid: 11,
    agent_pid: 12,
    pid_chain: [11, 12],
    ...extra,
  });

  it("replaces bubble and transient-session focus with the fresh walk", async () => {
    let resolverCalls = 0;
    const res = await callPermissionPost(body(), {
      headers,
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("b1a-authoritative"),
        resolveWindowsProcessMetadata: ({ agentId, hookPid, preferAgentPid }) => {
          resolverCalls++;
          assert.deepStrictEqual({ agentId, hookPid, preferAgentPid }, {
            agentId: "codex",
            hookPid: 7654,
            preferAgentPid: false,
          });
          return {
            status: "ok",
            sourcePid: 101,
            agentPid: 202,
            pidChain: [101, 202, 303],
            editor: null,
          };
        },
      },
    });

    assert.strictEqual(resolverCalls, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.sourcePid, 101);
    assert.strictEqual(entry.agentPid, 202);
    assert.deepStrictEqual(entry.pidChain, [101, 202, 303]);
    const opts = res.ctx.calls.updateSession[0][3];
    assert.strictEqual(opts.sourcePid, 101);
    assert.strictEqual(opts.agentPid, 202);
    assert.deepStrictEqual(opts.pidChain, [101, 202, 303]);
    assert.strictEqual(opts.replaceProcessMetadata, true);
  });

  it("persists an authoritative unavailable result as an explicit clear", async () => {
    const res = await callPermissionPost(body(), {
      headers,
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("b1a-authoritative"),
        resolveWindowsProcessMetadata: () => ({ status: "unavailable", reason: "access-denied" }),
      },
    });

    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.sourcePid, null);
    assert.strictEqual(entry.agentPid, null);
    assert.strictEqual(entry.pidChain, null);
    const opts = res.ctx.calls.updateSession[0][3];
    assert.strictEqual(opts.sourcePid, null);
    assert.strictEqual(opts.agentPid, null);
    assert.strictEqual(opts.pidChain, null);
    assert.strictEqual(opts.replaceProcessMetadata, true);
  });

  it("also resolves before native-mode updateSession and preserves no-decision", async () => {
    const res = await callPermissionPost(body(), {
      headers,
      ctx: { isCodexPermissionInterceptEnabled: () => false },
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("b1a-authoritative"),
        resolveWindowsProcessMetadata: () => ({
          status: "ok",
          sourcePid: 401,
          agentPid: 402,
          pidChain: [401, 402],
          editor: null,
        }),
      },
    });

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.ctx.pendingPermissions.length, 0);
    const opts = res.ctx.calls.updateSession[0][3];
    assert.strictEqual(opts.sourcePid, 401);
    assert.strictEqual(opts.replaceProcessMetadata, true);
    assert.strictEqual(opts.transientPermissionEvent, true);
  });

  it("does not resolve on DND/headless/disabled no-decision short circuits", async () => {
    const variants = [
      { ctx: { doNotDisturb: true }, extra: {} },
      { ctx: {}, extra: { headless: true } },
      { ctx: { isAgentEnabled: () => false }, extra: {} },
    ];
    for (const variant of variants) {
      let resolverCalls = 0;
      const res = await callPermissionPost(body(variant.extra), {
        headers,
        ctx: variant.ctx,
        options: {
          isWinHost: true,
          windowsProcessChainRuntime: runtime("b1a-authoritative"),
          resolveWindowsProcessMetadata: () => { resolverCalls++; return { status: "ok" }; },
        },
      });
      assert.strictEqual(resolverCalls, 0);
      assert.strictEqual(res.statusCode, 204);
    }
  });

  it("keeps shadow metadata legacy-authoritative and records parity", async () => {
    const records = [];
    const res = await callPermissionPost(body({ editor: "code" }), {
      headers,
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("shadow"),
        resolveWindowsProcessMetadata: () => ({
          status: "ok",
          sourcePid: 21,
          agentPid: 22,
          pidChain: [21, 22],
          editor: "code",
        }),
        recordWindowsProcessChainShadow: (record) => records.push(record),
      },
    });

    assert.strictEqual(res.ctx.pendingPermissions[0].sourcePid, 11);
    assert.strictEqual(res.ctx.calls.updateSession[0][3].replaceProcessMetadata, undefined);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].comparison.all, false);
    assert.strictEqual(records[0].comparison.editor, true);
    assert.deepStrictEqual(records[0].legacyMetadata, {
      sourcePid: 11, agentPid: 12, pidChain: [11, 12], editor: "code",
    });
    assert.deepStrictEqual(records[0].candidateMetadata, {
      sourcePid: 21, agentPid: 22, pidChain: [21, 22], editor: "code",
    });
  });

  it("drops an unrecognized legacy editor before permission shadow comparison", async () => {
    const records = [];
    await callPermissionPost(body({ editor: "notepad" }), {
      headers,
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("shadow"),
        resolveWindowsProcessMetadata: () => ({
          status: "ok",
          sourcePid: 11,
          agentPid: 12,
          pidChain: [11, 12],
          editor: null,
        }),
        recordWindowsProcessChainShadow: (record) => records.push(record),
      },
    });
    assert.strictEqual(records[0].legacyMetadata.editor, null);
    assert.strictEqual(records[0].comparison.editor, true);
  });

  it("uses agentPid as the Codex Desktop source and rejects mismatched generations", async () => {
    let preferAgentPid = null;
    const desktop = await callPermissionPost(body({ codex_originator: "codex_work_desktop" }), {
      headers,
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("b1a-authoritative"),
        resolveWindowsProcessMetadata: (request) => {
          preferAgentPid = request.preferAgentPid;
          return { status: "ok", sourcePid: 99, agentPid: 99, pidChain: [99], editor: null };
        },
      },
    });
    assert.strictEqual(preferAgentPid, true);
    assert.strictEqual(desktop.ctx.pendingPermissions[0].sourcePid, 99);

    let mismatchCalls = 0;
    const mismatch = await callPermissionPost(body(), {
      headers: {
        [DUCK_HOOK_PID_HEADER.toLowerCase()]: "7654",
        [DUCK_PROCESS_INSTANCE_HEADER.toLowerCase()]: "old-generation",
      },
      options: {
        isWinHost: true,
        windowsProcessChainRuntime: runtime("b1a-authoritative"),
        resolveWindowsProcessMetadata: () => { mismatchCalls++; return { status: "ok" }; },
      },
    });
    assert.strictEqual(mismatchCalls, 0);
    assert.strictEqual(mismatch.ctx.pendingPermissions[0].sourcePid, 11);
  });
});

describe("server-route-permission POST — CC subagent requests (#451)", () => {
  const SUBAGENT_UUID = "0199f2c5-1bb8-7892-9e3b-1d6f4a1c2b3d";

  function subagentBody(overrides = {}) {
    return JSON.stringify({
      agent_id: SUBAGENT_UUID,
      agent_type: "code-reviewer",
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_use_id: "tool-1",
      ...overrides,
    });
  }

  it("bubbles a subagent permission under the claude-code identity by default", async () => {
    const res = await callPermissionPost(subagentBody());

    assert.strictEqual(res.statusCode, null);
    assert.strictEqual(res.destroyed, false);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    // Regression guard: the uuid used to leak into permEntry.agentId /
    // updateSession, mislabeling the session and dodging every per-agent gate.
    assert.strictEqual(entry.agentId, "claude-code");
    assert.strictEqual(entry.subagentId, SUBAGENT_UUID);
    assert.strictEqual(entry.subagentType, "code-reviewer");
    assert.deepStrictEqual(res.ctx.calls.updateSession, [[
      localSessionKey("sid"),
      "notification",
      "PermissionRequest",
      {
        agentId: "claude-code",
        profileId: "local",
        rawSessionId: "sid",
        sessionAutomationIdentity: {
          eligible: false,
          reason: "identity-verification-required",
        },
      },
    ]]);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, [entry]);
  });

  it("stamps main-thread CC entries with null subagent fields", async () => {
    const res = await callPermissionPost(JSON.stringify({
      agent_id: "claude-code",
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }));

    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.subagentId, null);
    assert.strictEqual(entry.subagentType, null);
  });

  for (const [label, toolName, toolInput] of [
    ["permission", "Bash", { command: "npm test" }],
    ["elicitation", "AskUserQuestion", { questions: [{ question: "Continue?" }] }],
  ]) {
    it(`records a disconnected Claude ${label} as no-decision, not a user denial`, async () => {
      const res = await callPermissionPost(JSON.stringify({
        agent_id: "claude-code",
        session_id: "sid-disconnect",
        tool_name: toolName,
        tool_input: toolInput,
      }));

      assert.strictEqual(res.ctx.pendingPermissions.length, 1);
      const entry = res.ctx.pendingPermissions[0];
      res.emit("close");
      assert.strictEqual(res.ctx.calls.resolved.length, 1);
      assert.strictEqual(res.ctx.calls.resolved[0].entry, entry);
      assert.strictEqual(res.ctx.calls.resolved[0].behavior, "no-decision");
      assert.strictEqual(res.ctx.calls.resolved[0].message, "Client disconnected");
    });
  }

  it("destroys the connection when the subagent sub-gate is off", async () => {
    const res = await callPermissionPost(subagentBody(), {
      ctx: {
        isAgentSubagentPermissionsEnabled: (agentId) => agentId !== "claude-code",
      },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["accepted"]);
  });

  it("keeps bubbling main-thread requests while the subagent sub-gate is off", async () => {
    const res = await callPermissionPost(JSON.stringify({
      session_id: "sid",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    }), {
      ctx: {
        isAgentSubagentPermissionsEnabled: () => false,
      },
    });

    assert.strictEqual(res.statusCode, null);
    assert.strictEqual(res.destroyed, false);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    assert.strictEqual(res.ctx.pendingPermissions[0].agentId, "claude-code");
  });

  it("still bubbles subagent AskUserQuestion as elicitation when the sub-gate is off", async () => {
    const res = await callPermissionPost(subagentBody({
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Continue?" }] },
    }), {
      ctx: {
        isAgentSubagentPermissionsEnabled: () => false,
      },
    });

    assert.strictEqual(res.destroyed, false);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    const entry = res.ctx.pendingPermissions[0];
    assert.strictEqual(entry.isElicitation, true);
    assert.strictEqual(entry.agentId, "claude-code");
    assert.strictEqual(entry.subagentId, SUBAGENT_UUID);
  });

  it("still bubbles subagent ExitPlanMode when the sub-gate is off", async () => {
    const res = await callPermissionPost(subagentBody({
      tool_name: "ExitPlanMode",
      tool_input: { plan: "ship it" },
    }), {
      ctx: {
        isAgentSubagentPermissionsEnabled: () => false,
      },
    });

    assert.strictEqual(res.destroyed, false);
    assert.strictEqual(res.ctx.pendingPermissions.length, 1);
    assert.strictEqual(res.ctx.pendingPermissions[0].toolName, "ExitPlanMode");
  });

  it("handles a verbatim CC 2.1.169 subagent payload (live capture 2026-06-10)", async () => {
    // Captured from a real Claude Code 2.1.169 Task-subagent run via an
    // isolated PermissionRequest HTTP hook (paths anonymized). Ground truth
    // for the field shapes the #451 gate relies on: agent_id is a 17-hex
    // instance id (NOT a uuid), agent_type is the subagent type, and
    // session_id is the PARENT session's id.
    const realBody = {
      session_id: "0c2c2e1a-614f-4928-84bf-f4baf5e197f4",
      transcript_path: "/Users/tester/.claude/projects/-Users-tester-repo/0c2c2e1a-614f-4928-84bf-f4baf5e197f4.jsonl",
      cwd: "/Users/tester/repo",
      permission_mode: "default",
      agent_id: "a8fb8638225be89d4",
      agent_type: "general-purpose",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "touch /tmp/cc451-proof.txt", description: "Create proof file" },
      permission_suggestions: [
        { type: "addDirectories", directories: ["/tmp"], destination: "session" },
        { type: "setMode", mode: "acceptEdits", destination: "session" },
      ],
    };

    const bubbled = await callPermissionPost(JSON.stringify(realBody));
    assert.strictEqual(bubbled.ctx.pendingPermissions.length, 1);
    const entry = bubbled.ctx.pendingPermissions[0];
    assert.strictEqual(entry.agentId, "claude-code");
    assert.strictEqual(entry.subagentId, "a8fb8638225be89d4");
    assert.strictEqual(entry.subagentType, "general-purpose");
    assert.strictEqual(entry.suggestions.length, 2);

    const suppressed = await callPermissionPost(JSON.stringify(realBody), {
      ctx: { isAgentSubagentPermissionsEnabled: () => false },
    });
    assert.strictEqual(suppressed.destroyed, true);
    assert.deepStrictEqual(suppressed.ctx.pendingPermissions, []);
  });

  it("lets the headless guard win over the subagent sub-gate (auto-deny, no destroy)", async () => {
    const res = await callPermissionPost(subagentBody(), {
      ctx: {
        sessions: new Map([[localSessionKey("sid"), { headless: true }]]),
        isAgentSubagentPermissionsEnabled: () => false,
      },
    });

    assert.strictEqual(res.destroyed, false);
    assert.deepStrictEqual(res.ctx.calls.sendPermissionResponse, [{
      behavior: "deny",
      message: "Non-interactive session; auto-denied",
    }]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
  });

  it("lets PASSTHROUGH tools auto-allow before the subagent sub-gate", async () => {
    const res = await callPermissionPost(subagentBody({
      tool_name: "TaskList",
      tool_input: {},
    }), {
      ctx: {
        PASSTHROUGH_TOOLS: new Set(["TaskList"]),
        isAgentSubagentPermissionsEnabled: () => false,
      },
    });

    assert.strictEqual(res.destroyed, false);
    assert.deepStrictEqual(res.ctx.calls.sendPermissionResponse, [{
      behavior: "allow",
      message: undefined,
    }]);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
  });

  it("applies the per-agent permission subgate to subagent requests (uuid no longer dodges it)", async () => {
    const res = await callPermissionPost(subagentBody(), {
      ctx: {
        isAgentPermissionsEnabled: (agentId) => agentId !== "claude-code",
      },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.ctx.calls.showPermissionBubble, []);
  });

  it("applies the agent master switch to subagent requests (uuid no longer dodges it)", async () => {
    const res = await callPermissionPost(subagentBody(), {
      ctx: {
        isAgentEnabled: (agentId) => agentId !== "claude-code",
      },
    });

    assert.strictEqual(res.destroyed, true);
    assert.deepStrictEqual(res.ctx.pendingPermissions, []);
    assert.deepStrictEqual(res.recorder.map((item) => item.outcome).filter(Boolean), ["disabled"]);
  });
});
