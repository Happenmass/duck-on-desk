const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");

// themes/duck is a duck3d theme: its state files are intent ids and it declares
// no displayHintMap, so hook display hints are exercised on the sprite fixture.
const themeLoader = require("../src/shell/theme-loader");
const { loadSpriteTheme } = require("./fixtures/sprite-theme");
themeLoader.init(path.join(__dirname, "..", "src"));
const _defaultTheme = themeLoader.loadTheme("duck");
const _spriteTheme = loadSpriteTheme("crab");

function makeCtx(theme = _defaultTheme) {
  return {
    theme,
    doNotDisturb: false,
    miniTransitioning: false,
    miniMode: false,
    mouseOverPet: false,
    idlePaused: false,
    forceEyeResend: false,
    mouseStillSince: Date.now(),
    playSound() {},
    sendToRenderer() {},
    syncHitWin() {},
    sendToHitWin() {},
    miniPeekIn() {},
    miniPeekOut() {},
    buildContextMenu() {},
    buildTrayMenu() {},
    pendingPermissions: [],
    resolvePermissionEntry() {},
    t: (k) => k,
    focusTerminalWindow() {},
  };
}

describe("display_svg session hints (updateSession path)", () => {
  let api;
  const pid = process.pid;

  beforeEach(() => {
    api = require("../src/state/state")(makeCtx(_spriteTheme));
  });

  function baseOpts(overrides = {}) {
    return {
      cwd: "/tmp",
      editor: "cursor",
      agentPid: pid,
      agentId: "claude-code",
      ...overrides,
    };
  }

  it("uses allowlisted display_svg for working state", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts({ displayHint: "duck-working-building.svg" }));
    assert.strictEqual(api.getSvgOverride("working"), "duck-working-building.svg");
  });

  it("falls back to getWorkingSvg when no hint", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts());
    assert.strictEqual(api.getSvgOverride("working"), "duck-working-typing.svg");
  });

  it("ignores non-allowlisted svg and falls back", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts({ displayHint: "evil.svg" }));
    assert.strictEqual(api.getSvgOverride("working"), "duck-working-typing.svg");
  });

  it("picks the most recently updated session among working sessions", async () => {
    api.updateSession("a", "working", "PreToolUse", baseOpts({ cwd: "/a", displayHint: "duck-working-building.svg" }));
    await new Promise((r) => setTimeout(r, 5));
    api.updateSession("b", "working", "PostToolUse", baseOpts({ cwd: "/b", displayHint: "duck-idle-reading.svg" }));
    assert.strictEqual(api.getSvgOverride("working"), "duck-idle-reading.svg");
  });

  it("clears hint when display_svg is null", () => {
    api.updateSession("c1", "working", "PreToolUse", baseOpts({ displayHint: "duck-working-building.svg" }));
    assert.strictEqual(api.getSvgOverride("working"), "duck-working-building.svg");
    api.updateSession("c1", "working", "PostToolUse", baseOpts({ displayHint: null }));
    assert.strictEqual(api.getSvgOverride("working"), "duck-working-typing.svg");
  });

  it("applies thinking hint for thinking state", () => {
    api.updateSession("c1", "thinking", "AfterAgentThought", baseOpts({ displayHint: "duck-working-thinking.svg" }));
    assert.strictEqual(api.getSvgOverride("thinking"), "duck-working-thinking.svg");
  });
});

// #509: user-selected default idle visual flows through state.js
describe("default idle visual (getIdleVisualChoice ctx hook)", () => {
  it("getSvgOverride('idle') returns the user choice when set", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => "duck-carrying";
    const api = require("../src/state/state")(ctx);
    assert.strictEqual(api.getSvgOverride("idle"), "duck-carrying");
  });

  it("getSvgOverride('idle') falls back to the follow sprite when unset", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => null;
    const api = require("../src/state/state")(ctx);
    assert.strictEqual(api.getSvgOverride("idle"), "duck-idle");

    const apiNoHook = require("../src/state/state")(makeCtx());
    assert.strictEqual(apiNoHook.getSvgOverride("idle"), "duck-idle");
  });

  it("applyState('idle') with no override rests on the user choice", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => "duck-carrying";
    const api = require("../src/state/state")(ctx);
    api.applyState("idle");
    assert.strictEqual(api.getCurrentSvg(), "duck-carrying");
  });

  it("applyState('idle') without the hook keeps today's behavior", () => {
    const api = require("../src/state/state")(makeCtx());
    api.applyState("idle");
    assert.strictEqual(api.getCurrentSvg(), "duck-idle");
  });

  it("an explicit svgOverride still wins over the user choice", () => {
    const ctx = makeCtx();
    ctx.getIdleVisualChoice = () => "duck-carrying";
    const api = require("../src/state/state")(ctx);
    api.applyState("idle", "duck-notification");
    assert.strictEqual(api.getCurrentSvg(), "duck-notification");
  });
});
