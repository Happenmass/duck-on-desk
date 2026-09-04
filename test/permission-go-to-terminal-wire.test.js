// Wire-level tests for the "Go to Terminal" (deny-and-focus) action on
// regular permission cards (issue #689). The renderer DOM half of the chain
// is covered by bubble-go-to-terminal.test.js; these tests pin the backend
// half: handleDecide → per-protocol wire outcome. They guard the P0 found in
// the first cut of the fix: Claude Code blocks on the PermissionRequest HTTP
// hook (600s) and shows nothing in the terminal while it is pending. The
// socket must be DESTROYED (dropped connection = non-blocking hook error →
// native prompt takes over immediately), never parked until the hook
// timeout, and never answered with a deny on the user's behalf.

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

// ── Mock electron before requiring permission.js (same seam as
// permission-plan-feedback.test.js) ──
const __electronMock = {
  BrowserWindow: { fromWebContents: (sender) => (sender && sender.__win) || null },
  globalShortcut: {
    register: () => {}, unregister: () => {}, unregisterAll: () => {}, isRegistered: () => false,
  },
};
const __origModuleLoad = Module._load;
Module._load = function (request) {
  if (request === "electron") return __electronMock;
  return __origModuleLoad.apply(this, arguments);
};
const initPermission = require("../src/permission");
Module._load = __origModuleLoad;

function createMockResponse() {
  const captured = {
    statusCode: null,
    headers: {},
    body: null,
    ended: false,
    listeners: {},
  };
  return {
    captured,
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    setHeader(key, value) { captured.headers[key] = value; },
    writeHead(status, headers) {
      captured.statusCode = status;
      this.headersSent = true;
      if (headers) Object.assign(captured.headers, headers);
    },
    write(chunk) { captured.body = (captured.body || "") + String(chunk); },
    end(chunk) {
      if (chunk !== undefined) captured.body = (captured.body || "") + String(chunk);
      captured.ended = true;
      this.writableEnded = true;
    },
    on(evt, fn) {
      (captured.listeners[evt] = captured.listeners[evt] || []).push(fn);
    },
    removeListener(evt, fn) {
      const arr = captured.listeners[evt] || [];
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    destroy() { this.destroyed = true; },
  };
}

function makeCtx(overrides = {}) {
  return {
    focusTerminalCalls: [],
    focusTerminalForSession(sessionId, opts) {
      this.focusTerminalCalls.push({ sessionId, opts });
    },
    getSettingsSnapshot: () => ({}),
    isAgentPermissionsEnabled: () => true,
    getBubblePolicy: () => ({ enabled: true, autoCloseMs: null }),
    getPetWindowBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }),
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    getHitRectScreen: () => null,
    getHudReservedOffset: () => 0,
    guardAlwaysOnTop: () => {},
    reapplyMacVisibility: () => {},
    permDebugLog: null,
    updateDebugLog: null,
    sessionDebugLog: null,
    repositionUpdateBubble: () => {},
    win: null,
    bubbleFollowPet: false,
    petHidden: false,
    doNotDisturb: false,
    hideBubbles: false,
    sessions: new Map(),
    pendingPermissions: [],
    subscribeShortcuts: () => () => {},
    reportShortcutFailure: () => {},
    clearShortcutFailure: () => {},
    onPermissionsChanged: () => {},
    onPermissionResolved: () => {},
    STATE_SVGS: {},
    setState: () => {},
    updateSession: () => {},
    ...overrides,
  };
}

function makeFakeBubble() {
  return { isDestroyed: () => false, webContents: { send: () => {} }, destroy: () => {} };
}
function makeEventFor(bubble) {
  return { sender: { __win: bubble } };
}

function makePermEntry(res, overrides = {}) {
  const entry = {
    res,
    abortHandler: () => {},
    suggestions: [],
    sessionId: "wire-session-1",
    bubble: null,
    hideTimer: null,
    toolName: "Bash",
    toolInput: { command: "rm -rf build" },
    resolvedSuggestion: null,
    createdAt: Date.now() - 5000,
    ...overrides,
  };
  // Mirror the server route: the abort handler is registered on the socket.
  res.on("close", entry.abortHandler);
  return entry;
}

describe("go-to-terminal wire semantics (issue #689)", () => {
  it("destroys the CC hook socket without a decision and focuses the terminal", () => {
    const ctx = makeCtx();
    const perm = initPermission(ctx);
    const { pendingPermissions, handleDecide } = perm;

    const res = createMockResponse();
    const bubble = makeFakeBubble();
    const permEntry = makePermEntry(res, { bubble });
    pendingPermissions.push(permEntry);

    handleDecide(makeEventFor(bubble), "deny-and-focus");

    // Dropped, not parked; empty, not denied.
    assert.strictEqual(res.destroyed, true, "hook socket must be destroyed immediately");
    assert.strictEqual(res.captured.ended, false, "no response may be written");
    assert.strictEqual(res.captured.body, null, "no decision body may be written");
    // Abort handler detached before destroy — the close event can't
    // double-resolve the removed entry.
    assert.deepStrictEqual(res.captured.listeners.close, [], "close listener must be detached");
    assert.strictEqual(pendingPermissions.indexOf(permEntry), -1, "entry must be removed");
    assert.strictEqual(ctx.focusTerminalCalls.length, 1);
    assert.strictEqual(ctx.focusTerminalCalls[0].sessionId, "wire-session-1");
  });

  it("treats a repeated deny-and-focus for the same bubble as a no-op", () => {
    const ctx = makeCtx();
    const perm = initPermission(ctx);
    const { pendingPermissions, handleDecide } = perm;

    const res = createMockResponse();
    const bubble = makeFakeBubble();
    const permEntry = makePermEntry(res, { bubble });
    pendingPermissions.push(permEntry);

    handleDecide(makeEventFor(bubble), "deny-and-focus");
    handleDecide(makeEventFor(bubble), "deny-and-focus");

    assert.strictEqual(ctx.focusTerminalCalls.length, 1, "second IPC must not focus again");
    assert.strictEqual(pendingPermissions.length, 0);
  });

  for (const agentId of ["opencode"]) {
    it(`${agentId}: deny-and-focus leaves the family bridge unanswered`, () => {
      const ctx = makeCtx();
      const perm = initPermission(ctx);
      const { pendingPermissions, handleDecide } = perm;
      const bubble = makeFakeBubble();
      const permEntry = makePermEntry(createMockResponse(), {
        bubble,
        agentId,
        familyRequestId: `per_${agentId}`,
        familyBridgeUrl: "http://127.0.0.1:1/reply",
        familyBridgeToken: "token",
        toolName: "bash",
      });
      permEntry.res = null;
      pendingPermissions.push(permEntry);

      handleDecide(makeEventFor(bubble), "deny-and-focus");

      assert.strictEqual(pendingPermissions.indexOf(permEntry), -1, "entry must be removed");
      assert.strictEqual(ctx.focusTerminalCalls.length, 1);
    });
  }

});
