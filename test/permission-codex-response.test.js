"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const { describe, it } = require("node:test");

const PERMISSION_MODULE_PATH = require.resolve("../src/permission");

function loadPermissionWithElectron(fakeElectron = null) {
  delete require.cache[PERMISSION_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return fakeElectron || {
        BrowserWindow: Object.assign(class {}, { fromWebContents() { return null; } }),
        globalShortcut: {
          register() { return true; },
          unregister() {},
          isRegistered() { return false; },
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/permission");
  } finally {
    Module._load = originalLoad;
  }
}

function createCodexDecisionHarness() {
  const focusCalls = [];
  const fakeElectron = {
    BrowserWindow: Object.assign(class {}, {
      fromWebContents(sender) { return sender && sender.__window ? sender.__window : null; },
    }),
    globalShortcut: {
      register() { return true; },
      unregister() {},
      isRegistered() { return false; },
    },
  };
  const initPermission = loadPermissionWithElectron(fakeElectron);
  const api = initPermission({
    sessions: new Map(),
    hideBubbles: false,
    petHidden: false,
    win: null,
    lang: "en",
    getBubblePolicy: () => ({ enabled: true, autoCloseMs: null }),
    focusTerminalForSession: (sessionId, options) => focusCalls.push([sessionId, options]),
    permDebugLog: null,
  });
  return { api, focusCalls };
}

function createFakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: "",
    writableEnded: false,
    writableFinished: false,
    destroyed: false,
    _listeners: new Map(),
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
    },
    end(data) {
      if (data) this.body += String(data);
      this.writableEnded = true;
      this.writableFinished = true;
    },
    on(event, handler) {
      this._listeners.set(event, handler);
      return this;
    },
    removeListener(event, handler) {
      if (this._listeners.get(event) === handler) this._listeners.delete(event);
      return this;
    },
    destroy() {
      this.destroyed = true;
      this.writableEnded = true;
      this.writableFinished = true;
      const handler = this._listeners.get("close");
      if (handler) handler();
    },
  };
  return res;
}

function createFakeBubble() {
  const bubble = {
    hidden: false,
    destroyed: false,
    webContents: {
      send(event) {
        if (event === "permission-hide") bubble.hidden = true;
      },
    },
    isDestroyed() { return this.destroyed; },
    destroy() { this.destroyed = true; },
  };
  return bubble;
}

describe("Codex permission response sanitizer", () => {
  it("omits unsupported fail-closed fields instead of setting them to null", () => {
    const permission = loadPermissionWithElectron();
    const body = permission.__test.buildCodexPermissionResponseBody({
      behavior: "allow",
      message: "ignored",
      updatedInput: null,
      updatedPermissions: [{ type: "setMode", mode: "default" }],
      interrupt: true,
    });
    const parsed = JSON.parse(body);
    const decision = parsed.hookSpecificOutput.decision;

    assert.deepStrictEqual(decision, { behavior: "allow" });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, "updatedInput"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, "updatedPermissions"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(decision, "interrupt"), false);
  });

  it("keeps deny messages and rejects invalid decisions as no-decision", () => {
    const permission = loadPermissionWithElectron();
    const denyBody = permission.__test.buildCodexPermissionResponseBody("deny", "Blocked");
    const deny = JSON.parse(denyBody).hookSpecificOutput.decision;

    assert.deepStrictEqual(deny, { behavior: "deny", message: "Blocked" });
    assert.strictEqual(permission.__test.buildCodexPermissionResponseBody({ behavior: "ask" }), "{}");
  });

  it("treats Codex deny-and-focus as immediate no-decision instead of hanging the socket", () => {
    const { api, focusCalls } = createCodexDecisionHarness();
    const res = createFakeRes();
    const bubble = createFakeBubble();
    const permEntry = {
      res,
      abortHandler: () => {},
      suggestions: [],
      sessionId: "codex:s1",
      bubble,
      hideTimer: null,
      toolName: "Bash",
      toolInput: { command: "npm test" },
      createdAt: Date.now(),
      agentId: "codex",
      isCodex: true,
      sourcePid: 456,
      cwd: "/repo",
      agentPid: 456,
      pidChain: [789, 456],
      platform: "webui",
      model: "gpt-5.4",
      codexOriginator: "Codex Desktop",
      codexSource: "vscode",
    };
    api.pendingPermissions.push(permEntry);

    api.handleDecide({ sender: { __window: bubble } }, "deny-and-focus");

    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.writableEnded, true);
    assert.strictEqual(res.body, "");
    assert.deepStrictEqual(focusCalls, [[
      "codex:s1",
      {
        fallbackEntry: {
          id: "codex:s1",
          agentId: "codex",
          sourcePid: 456,
          cwd: "/repo",
          agentPid: 456,
          pidChain: [789, 456],
          platform: "webui",
          model: "gpt-5.4",
          codexOriginator: "Codex Desktop",
          codexSource: "vscode",
        },
      },
    ]]);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("dismisses a Codex passive notify without focusing the terminal", () => {
    const { api, focusCalls } = createCodexDecisionHarness();
    const bubble = createFakeBubble();
    api.pendingPermissions.push({
      res: null,
      abortHandler: null,
      suggestions: [],
      sessionId: "codex:s1",
      bubble,
      hideTimer: null,
      toolName: "CodexExec",
      toolInput: { command: "npm test" },
      createdAt: Date.now(),
      agentId: "codex",
      isCodexNotify: true,
    });

    api.handleDecide({ sender: { __window: bubble } }, "allow");

    // Codex notify stays a plain acknowledge: no focus-on-dismiss affordance.
    // Pins the shared passive-notify branch against accidental scope creep.
    assert.deepStrictEqual(focusCalls, []);
    assert.strictEqual(bubble.hidden, true);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("does not let Codex take suggestion or opencode-only decision paths", () => {
    for (const behavior of ["suggestion:0", "family-always"]) {
      const { api } = createCodexDecisionHarness();
      const res = createFakeRes();
      const bubble = createFakeBubble();
      api.pendingPermissions.push({
        res,
        abortHandler: () => {},
        suggestions: [{ type: "setMode", mode: "default" }],
        sessionId: "codex:s1",
        bubble,
        hideTimer: null,
        toolName: "Bash",
        toolInput: { command: "npm test" },
        createdAt: Date.now(),
        agentId: "codex",
        isCodex: true,
      });

      api.handleDecide({ sender: { __window: bubble } }, behavior);

      assert.strictEqual(res.statusCode, 204);
      assert.strictEqual(res.body, "");
      assert.strictEqual(api.pendingPermissions.length, 0);
    }
  });

  it("dismisses DND permissions without approving or denying on the user's behalf", () => {
    const { api } = createCodexDecisionHarness();
    const codexRes = createFakeRes();
    const claudeRes = createFakeRes();
    const opencodeRes = createFakeRes();
    const codexBubble = createFakeBubble();
    const claudeBubble = createFakeBubble();
    const opencodeBubble = createFakeBubble();
    const notifyBubble = createFakeBubble();

    api.pendingPermissions.push(
      {
        res: codexRes,
        abortHandler: () => {},
        sessionId: "codex:s1",
        bubble: codexBubble,
        hideTimer: null,
        agentId: "codex",
        isCodex: true,
      },
      {
        res: claudeRes,
        abortHandler: () => {},
        sessionId: "claude:s1",
        bubble: claudeBubble,
        hideTimer: null,
        agentId: "claude-code",
      },
      {
        res: opencodeRes,
        sessionId: "opencode:s1",
        bubble: opencodeBubble,
        hideTimer: null,
        agentId: "opencode",
        bridgeUrl: "http://127.0.0.1:9",
        bridgeToken: "token",
        requestId: "req-1",
      },
      {
        sessionId: "codex:s1",
        bubble: notifyBubble,
        agentId: "codex",
        isCodexNotify: true,
      }
    );

    assert.strictEqual(api.dismissPermissionsForDnd(), 4);

    assert.strictEqual(codexRes.statusCode, 204);
    assert.strictEqual(codexRes.body, "");
    assert.strictEqual(claudeRes.destroyed, true);
    assert.strictEqual(opencodeRes.destroyed, false);
    assert.strictEqual(opencodeRes.statusCode, null);
    assert.strictEqual(codexBubble.hidden, true);
    assert.strictEqual(claudeBubble.hidden, true);
    assert.strictEqual(opencodeBubble.hidden, true);
    assert.strictEqual(notifyBubble.hidden, true);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("cleans up Claude permissions without deciding when Duck quits", () => {
    const { api } = createCodexDecisionHarness();
    const claudeRes = createFakeRes();
    api.pendingPermissions.push(
      {
        res: claudeRes,
        abortHandler: () => {},
        sessionId: "claude:s1",
        bubble: createFakeBubble(),
        hideTimer: null,
        agentId: "claude-code",
      }
    );

    api.cleanup();

    assert.strictEqual(claudeRes.destroyed, true);
    assert.strictEqual(claudeRes.body, "");
    assert.strictEqual(api.pendingPermissions.length, 0);
  });
});
