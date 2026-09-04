"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { describe, it, afterEach, mock } = require("node:test");
const {
  classifyPermissionInteraction,
} = require("../src/permission-automation-policy");

const PERMISSION_MODULE_PATH = require.resolve("../src/permission");
const tempLogPaths = new Set();

function loadPermissionWithElectron(fakeElectron) {
  delete require.cache[PERMISSION_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/permission");
  } finally {
    Module._load = originalLoad;
  }
}

function createTempLogPath() {
  const logPath = path.join(
    os.tmpdir(),
    `duck-permission-debug-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`
  );
  tempLogPaths.add(logPath);
  return logPath;
}

function createPermissionHarness({
  logPath = null,
  agentPermissionsEnabled = true,
  loadBehavior = "success",
} = {}) {
  const createdWindows = [];
  class FakeBrowserWindow {
    constructor() {
      if (loadBehavior === "constructor-throw") throw new Error("BrowserWindow unavailable");
      this.destroyed = false;
      this.bounds = null;
      this._closedHandler = null;
      this._didFinishLoad = null;
      this.webContents = {
        once: (event, cb) => {
          if (event === "did-finish-load") {
            // permission.js registers this after calling loadFile; fire
            // immediately in that case so bubbleReady is set and
            // syncPermissionBubbleContent really sends.
            if (this._loadFileCalled) { cb(); return; }
            this._didFinishLoad = cb;
          }
          if (event === "did-fail-load") this._didFailLoad = cb;
        },
        on: (event, cb) => {
          if (event === "render-process-gone") this._renderGoneHandler = cb;
        },
        send: (...args) => {
          this.sentEvents.push(args);
        },
      };
      this.sentEvents = [];
      createdWindows.push(this);
    }

    setAlwaysOnTop() {}
    setBounds(bounds) { this.bounds = bounds; }
    loadFile() {
      this._loadFileCalled = true;
      if (loadBehavior === "throw") throw new Error("bubble html missing");
      if (loadBehavior === "reject") {
        return Promise.reject(new Error("bubble html rejected"));
      }
      if (loadBehavior === "event") {
        if (typeof this._didFailLoad === "function") {
          this._didFailLoad({}, -6, "FILE_NOT_FOUND");
        }
        return;
      }
      if (typeof this._didFinishLoad === "function") this._didFinishLoad();
    }
    showInactive() {}
    setSkipTaskbar() {}
    on(event, cb) {
      if (event === "closed") this._closedHandler = cb;
    }
    isDestroyed() { return this.destroyed; }
    destroy() {
      this.destroyed = true;
      if (typeof this._closedHandler === "function") this._closedHandler();
    }
  }

  const fakeElectron = {
    BrowserWindow: Object.assign(FakeBrowserWindow, {
      // Same convention as the codex-response harness: an ipc event whose
      // sender carries __window resolves to that window, so handleDecide can
      // pair the event with its bubble entry. Events without it keep the old
      // null behavior.
      fromWebContents(sender) { return (sender && sender.__window) || null; },
    }),
    globalShortcut: {
      register() { return true; },
      unregister() {},
      isRegistered() { return false; },
    },
  };
  const permissionFactory = loadPermissionWithElectron(fakeElectron);
  let notificationAutoCloseMs = 10_000;
  const focused = [];
  const api = permissionFactory({
    win: { isDestroyed() { return false; } },
    permDebugLog: logPath,
    hideBubbles: false,
    doNotDisturb: false,
    bubbleFollowPet: false,
    sessions: new Map(),
    getBubblePolicy(kind) {
      if (kind === "notification") {
        return { enabled: notificationAutoCloseMs > 0, autoCloseMs: notificationAutoCloseMs };
      }
      return { enabled: true, autoCloseMs: null };
    },
    getSettingsSnapshot: () => ({ shortcuts: {} }),
    isAgentPermissionsEnabled: () => agentPermissionsEnabled,
    subscribeShortcuts: () => () => {},
    clearShortcutFailure: () => {},
    reportShortcutFailure: () => {},
    getPetWindowBounds: () => ({ x: 200, y: 200, width: 128, height: 128 }),
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    getHitRectScreen: () => null,
    getHudReservedOffset: () => 0,
    repositionUpdateBubble: () => {},
    focusTerminalForSession: (...args) => focused.push(args),
    guardAlwaysOnTop: () => {},
    reapplyMacVisibility: () => {},
  });

  return {
    api,
    focused,
    createdWindows,
    setNotificationAutoCloseMs(value) {
      notificationAutoCloseMs = value;
    },
  };
}

describe("permission passive notify auto-close refresh", () => {
  afterEach(() => {
    mock.timers.reset();
    delete require.cache[PERMISSION_MODULE_PATH];
    for (const logPath of tempLogPaths) {
      try { fs.unlinkSync(logPath); } catch {}
    }
    tempLogPaths.clear();
  });

  it("recomputes the remaining lifetime for visible notify bubbles", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    mock.timers.setTime(100_000);
    const harness = createPermissionHarness();
    const { api } = harness;

    const permEntry = {
      isCodexNotify: true,
      sessionId: "codex-a",
      bubble: null,
      hideTimer: null,
      autoExpireTimer: null,
      createdAt: Date.now() - 4_000,
    };
    api.pendingPermissions.push(permEntry);

    permEntry.autoExpireTimer = setTimeout(() => {}, 10_000);
    harness.setNotificationAutoCloseMs(3_000);

    api.refreshPassiveNotifyAutoClose();

    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("uses the remaining lifetime instead of restarting the full countdown", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    mock.timers.setTime(100_000);
    const harness = createPermissionHarness();
    const { api } = harness;

    const permEntry = {
      isCodexNotify: true,
      sessionId: "codex-a",
      bubble: null,
      hideTimer: null,
      autoExpireTimer: null,
      createdAt: Date.now() - 4_000,
    };
    api.pendingPermissions.push(permEntry);

    permEntry.autoExpireTimer = setTimeout(() => {}, 10_000);
    harness.setNotificationAutoCloseMs(7_000);

    api.refreshPassiveNotifyAutoClose();
    assert.strictEqual(api.pendingPermissions.length, 1);

    mock.timers.tick(2_999);
    assert.strictEqual(api.pendingPermissions.length, 1);

    mock.timers.tick(1);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

  it("ignores interactive permission bubbles when refreshing notify auto-close", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    mock.timers.setTime(100_000);
    const harness = createPermissionHarness();
    const { api } = harness;

    const interactiveEntry = {
      isCodexNotify: false,
      sessionId: "claude-a",
      bubble: null,
      hideTimer: null,
      autoExpireTimer: null,
      createdAt: Date.now(),
    };
    api.pendingPermissions.push(interactiveEntry);
    harness.setNotificationAutoCloseMs(1_000);

    api.refreshPassiveNotifyAutoClose();
    mock.timers.tick(5_000);

    assert.deepStrictEqual(api.pendingPermissions, [interactiveEntry]);
  });

  it("logs an explicit reason when Codex passive notifications are actively cleared", () => {
    const logPath = createTempLogPath();
    const harness = createPermissionHarness({ logPath });
    const { api } = harness;

    api.pendingPermissions.push({
      isCodexNotify: true,
      sessionId: "codex-a",
      bubble: null,
      hideTimer: null,
      autoExpireTimer: null,
      createdAt: Date.now(),
    });

    api.clearCodexNotifyBubbles("codex-a", "codex-state-transition");
    const logContent = fs.readFileSync(logPath, "utf8");

    assert.ok(
      logContent.includes("passive notify dismiss: agent=codex session=codex-a reason=codex-state-transition"),
      "clearing a Codex passive notification should log the active-dismiss reason"
    );
  });

  it("keeps Codex user-input cards passive until resolution and focuses native Codex", () => {
    const harness = createPermissionHarness();
    const { api } = harness;
    const shown = api.showCodexUserInputBubble({
      sessionId: "codex-a",
      callId: "call_1",
      questions: [{ id: "q", header: "Choice", question: "Pick one", options: [] }],
      sourcePid: 42,
      cwd: "/repo",
    });

    assert.strictEqual(shown, true);
    assert.strictEqual(api.pendingPermissions.length, 1);
    const entry = api.pendingPermissions[0];
    assert.strictEqual(entry.isCodexUserInputNotify, true);
    assert.strictEqual(entry.autoExpireTimer, null, "blocking questions must not use notification auto-expiry");
    assert.strictEqual(api.buildPermissionBubblePayload(entry).isCodexUserInputNotify, true);
    assert.strictEqual(api.refreshPassiveNotifyAutoClose(), 0);
    assert.strictEqual(api.pendingPermissions.length, 1);

    api.handleDecide({ sender: { __window: entry.bubble } }, "codex-user-input-focus");
    assert.strictEqual(api.pendingPermissions.length, 0);
    assert.strictEqual(harness.focused.length, 1);
    assert.strictEqual(harness.focused[0][0], "codex-a");
  });

  it("turns a stale Codex question expansion request into native focus", () => {
    const harness = createPermissionHarness();
    const { api } = harness;
    api.showCodexUserInputBubble({
      sessionId: "codex-expand",
      callId: "call_expand",
      questions: [{ id: "q", question: "Pick one", options: [] }],
      sourcePid: 42,
      cwd: "/repo",
    });
    const entry = api.pendingPermissions[0];

    assert.strictEqual(
      api.handleBubbleExpanded({ sender: { __window: entry.bubble } }, true),
      false
    );
    assert.strictEqual(api.pendingPermissions.length, 0);
    assert.strictEqual(harness.focused.length, 1);
    assert.strictEqual(harness.focused[0][0], "codex-expand");
  });

  it("dismisses a stale remote Codex expansion without focusing a local terminal", () => {
    const harness = createPermissionHarness();
    const { api } = harness;
    api.showCodexUserInputBubble({
      sessionId: "codex-remote-expand",
      callId: "call_remote_expand",
      questions: [{ id: "q", question: "Pick one", options: [] }],
      host: "remote.example",
      cwd: "/repo",
    });
    const entry = api.pendingPermissions[0];

    assert.strictEqual(
      api.handleBubbleExpanded({ sender: { __window: entry.bubble } }, true),
      false
    );
    assert.strictEqual(api.pendingPermissions.length, 0);
    assert.deepStrictEqual(harness.focused, []);
  });

  it("clears only the matching Codex user-input call", () => {
    const { api } = createPermissionHarness();
    for (const callId of ["call_1", "call_2"]) {
      api.showCodexUserInputBubble({
        sessionId: "codex-a",
        callId,
        questions: [{ id: "q", header: "Choice", question: callId, options: [] }],
      });
    }
    assert.strictEqual(api.clearCodexUserInputBubbles("codex-a", "call_1"), 1);
    assert.deepStrictEqual(api.pendingPermissions.map((entry) => entry.codexUserInputCallId), ["call_2"]);
  });

  it("does not treat a Codex question as a permission-mode feature", () => {
    const { api } = createPermissionHarness({ agentPermissionsEnabled: false });
    assert.strictEqual(api.showCodexUserInputBubble({
      sessionId: "codex-a",
      callId: "call_question",
      questions: [{ id: "q", header: "Choice", question: "Pick one", options: [] }],
    }), true);
    assert.strictEqual(api.pendingPermissions.length, 1);

    api.showCodexNotifyBubble({ sessionId: "codex-legacy", command: "rm" });
    assert.strictEqual(api.pendingPermissions.length, 1, "legacy permission cue remains gated");
  });

  it("logs when a passive notification expires immediately after policy shrink", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    mock.timers.setTime(100_000);
    const logPath = createTempLogPath();
    const harness = createPermissionHarness({ logPath });
    const { api } = harness;

    const permEntry = {
      isCodexNotify: true,
      sessionId: "codex-a",
      bubble: null,
      hideTimer: null,
      autoExpireTimer: null,
      createdAt: Date.now() - 4_000,
    };
    api.pendingPermissions.push(permEntry);

    harness.setNotificationAutoCloseMs(3_000);
    api.refreshPassiveNotifyAutoClose();
    const logContent = fs.readFileSync(logPath, "utf8");

    assert.ok(
      logContent.includes("passive notify dismiss: agent=codex session=codex-a reason=auto-expire-immediate"),
      "refreshing a notify bubble past its new lifetime should log the immediate-expire reason"
    );
  });

  it("deduplicates Codex passive notifications by session and refreshes the existing entry", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    mock.timers.setTime(100_000);
    const harness = createPermissionHarness();
    const { api } = harness;

    api.showCodexNotifyBubble({ sessionId: "codex-a", command: "first" });
    assert.strictEqual(api.pendingPermissions.length, 1);

    const existing = api.pendingPermissions[0];
    const originalBubble = existing.bubble;
    const firstCreatedAt = existing.createdAt;

    mock.timers.tick(500);
    api.showCodexNotifyBubble({ sessionId: "codex-a", command: "second" });

    assert.strictEqual(api.pendingPermissions.length, 1);
    assert.strictEqual(api.pendingPermissions[0], existing);
    assert.strictEqual(existing.bubble, originalBubble);
    assert.strictEqual(existing.toolInput.command, "second");
    assert.ok(existing.createdAt > firstCreatedAt);

    mock.timers.tick(9_999);
    assert.strictEqual(api.pendingPermissions.length, 1);

    mock.timers.tick(1);
    assert.strictEqual(api.pendingPermissions.length, 0);
  });

});

// Gate-ledger joint lifecycle (batched approvals): after the FIRST cue is
// gone — dismissed via the real ipc-decide path or auto-expired — state.js
// re-arms a cue for the next queued approval by showing the notify bubble
// again. The permission layer must build a brand-new working card each time;
// stale dedupe/bookkeeping from the dead entry must not swallow the re-show.
describe("interactive permission bubble fatal fallback", () => {
  afterEach(() => {
    mock.timers.reset();
    delete require.cache[PERMISSION_MODULE_PATH];
    for (const logPath of tempLogPaths) {
      try { fs.unlinkSync(logPath); } catch {}
    }
    tempLogPaths.clear();
  });

  function makeBlockingEntry() {
    const response = {
      writableEnded: false,
      destroyed: false,
      destroyCalls: 0,
      on() {},
      removeListener() {},
      destroy() {
        this.destroyCalls += 1;
        this.destroyed = true;
      },
    };
    return {
      response,
      entry: {
        res: response,
        abortHandler() {},
        suggestions: [],
        sessionId: "claude-fatal-bubble",
        bubble: null,
        hideTimer: null,
        toolName: "Bash",
        toolInput: { command: "npm test" },
        createdAt: Date.now(),
        agentId: "claude-code",
        interaction: classifyPermissionInteraction({
          agentId: "claude-code",
          eventKind: "permission",
          toolName: "Bash",
        }),
      },
    };
  }

  it("does not announce when BrowserWindow construction fails", () => {
    const harness = createPermissionHarness({ loadBehavior: "constructor-throw" });
    const { entry } = makeBlockingEntry();
    harness.api.pendingPermissions.push(entry);

    assert.throws(() => harness.api.showPermissionBubble(entry), /BrowserWindow unavailable/);
  });

  it("returns no-decision immediately when bubble.html cannot be loaded", () => {
    const harness = createPermissionHarness({ loadBehavior: "throw" });
    const { entry, response } = makeBlockingEntry();
    harness.api.pendingPermissions.push(entry);

    assert.doesNotThrow(() => harness.api.showPermissionBubble(entry));
    assert.strictEqual(harness.api.pendingPermissions.length, 0);
    assert.strictEqual(response.destroyed, true);
  });

  it("returns no-decision when loadFile rejects asynchronously", async () => {
    const harness = createPermissionHarness({ loadBehavior: "reject" });
    const { entry, response } = makeBlockingEntry();
    harness.api.pendingPermissions.push(entry);

    harness.api.showPermissionBubble(entry);
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(harness.api.pendingPermissions.length, 0);
    assert.strictEqual(response.destroyed, true);
    assert.strictEqual(response.destroyCalls, 1);
  });

  it("returns no-decision when the main frame emits did-fail-load", () => {
    const harness = createPermissionHarness({ loadBehavior: "event" });
    const { entry, response } = makeBlockingEntry();
    harness.api.pendingPermissions.push(entry);

    assert.doesNotThrow(() => harness.api.showPermissionBubble(entry));

    assert.strictEqual(harness.api.pendingPermissions.length, 0);
    assert.strictEqual(response.destroyed, true);
    assert.strictEqual(response.destroyCalls, 1);
  });

  it("does not turn a fatal no-decision into a second deny when closed fires", () => {
    const harness = createPermissionHarness({ loadBehavior: "throw" });
    const { entry, response } = makeBlockingEntry();
    harness.api.pendingPermissions.push(entry);

    harness.api.showPermissionBubble(entry);
    const bubble = harness.createdWindows[0];
    bubble._closedHandler();

    assert.strictEqual(harness.api.pendingPermissions.length, 0);
    assert.strictEqual(response.destroyCalls, 1);
  });

  it("skips permission-hide cleanly when a live bubble has no webContents", () => {
    const logPath = createTempLogPath();
    const harness = createPermissionHarness({ logPath });
    const { entry, response } = makeBlockingEntry();
    entry.createdAt = Date.now() - 5000;
    harness.api.pendingPermissions.push(entry);
    harness.api.showPermissionBubble(entry);
    entry.bubble.webContents = null;

    assert.doesNotThrow(() => {
      harness.api.resolvePermissionEntry(entry, "no-decision", "test cleanup");
    });

    assert.strictEqual(response.destroyCalls, 1);
    const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    assert.doesNotMatch(logText, /permission bubble hide failed/);
  });

  it("returns no-decision exactly once when the renderer process exits", () => {
    const harness = createPermissionHarness();
    const { entry, response } = makeBlockingEntry();
    harness.api.pendingPermissions.push(entry);
    harness.api.showPermissionBubble(entry);
    assert.strictEqual(harness.api.pendingPermissions.length, 1);

    const bubble = harness.createdWindows[0];
    bubble._renderGoneHandler({}, { reason: "crashed" });
    bubble._renderGoneHandler({}, { reason: "crashed" });

    assert.strictEqual(harness.api.pendingPermissions.length, 0);
    assert.strictEqual(response.destroyed, true);
  });

});
