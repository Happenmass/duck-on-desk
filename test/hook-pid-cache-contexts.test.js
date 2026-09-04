"use strict";
// test/hook-pid-cache-contexts.test.js — #634: every migrated adapter passes a
// correct lifecycle context to the shared resolver's cross-process pid cache.
//
// Two layers, mirroring the repo's split for this area:
//   A. In-process ctx capture (all platforms) — a fake resolve records the ctx
//      each adapter builds, pinning namespace / lifecycle mapping / the
//      RAW-session-id cacheable guard (a prefixed "<agent>:default" fallback
//      must NOT count as cacheable, cf. #583).
//   C. Consumer contract — every createPidResolver consumer builds a cache
//      context (or is explicitly exempted).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const HOOKS_DIR = path.join(__dirname, "..", "hooks");

// Full public metadata shape the resolver returns — adapters destructure all of
// these, so the capture stub must provide every field.
function fakeMeta() {
  return {
    stablePid: 4321, terminalPid: 4321, snapshotOk: true, agentPid: 8765,
    agentCommandLine: "", detectedEditor: null, pidChain: [],
    foregroundWtHwnd: null, tmuxSocket: null, tmuxClient: null, headless: false,
  };
}

function capture() {
  const calls = [];
  const fn = (ctx) => { calls.push(ctx); return fakeMeta(); };
  fn.calls = calls;
  return fn;
}

const stubPost = (body, opts, cb) => cb(false, null);

// ═════════════════════════════════════════════════════════════════════════════
// A. ctx capture — buildStateBody seams (codex)
// ═════════════════════════════════════════════════════════════════════════════

describe("#634 ctx contract — buildStateBody seams", () => {
  let hadRemote;
  before(() => { hadRemote = process.env.CLAWD_REMOTE; delete process.env.CLAWD_REMOTE; });
  after(() => { if (hadRemote !== undefined) process.env.CLAWD_REMOTE = hadRemote; });

  it("codex: state + permission bodies share the guard; Stop is not end", () => {
    const mod = require("../hooks/codex-hook.js");
    for (const [event, lifecycle] of [
      ["SessionStart", "start"], ["UserPromptSubmit", "prompt"], ["Stop", "event"], ["PreToolUse", "event"],
    ]) {
      const cap = capture();
      mod.buildStateBody({ hook_event_name: event, session_id: "cx1", cwd: "D:/repo" }, cap);
      assert.strictEqual(cap.calls[0].namespace, "codex", event);
      assert.strictEqual(cap.calls[0].lifecycle, lifecycle, event);
      assert.strictEqual(cap.calls[0].sessionId, "codex:cx1", event);
      assert.strictEqual(cap.calls[0].cacheable, true, event);
    }
    const cap = capture();
    mod.buildStateBody({ hook_event_name: "PreToolUse", cwd: "D:/repo" }, cap);
    assert.strictEqual(cap.calls[0].sessionId, "codex:default");
    assert.strictEqual(cap.calls[0].cacheable, false, "codex:default must not key a shared cache entry");
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// C. Consumer contract — no adapter silently stays on the bare (uncached) path
// ═════════════════════════════════════════════════════════════════════════════

describe("#634 consumer contract — ctx or explicit exemption", () => {
  // The offline-contract test locks the consumer COUNT; this locks the cache
  // MIGRATION: a createPidResolver consumer must build a cache context
  // (recognized by its `namespace: "` literal) or be exempted here on purpose.
  // Prewarm-style bare resolve() calls are fine — this only catches files with
  // no context anywhere.
  const EXEMPT = new Set([]);

  it("every createPidResolver consumer passes a cache context or is exempted", () => {
    const consumers = fs.readdirSync(HOOKS_DIR)
      .filter((f) => f.endsWith("-hook.js"))
      .filter((f) => fs.readFileSync(path.join(HOOKS_DIR, f), "utf8").includes("createPidResolver("));
    assert.ok(consumers.length >= 2, "sanity: the resolver consumers are all visible to this scan");
    const bare = consumers.filter((f) => {
      if (EXEMPT.has(f)) return false;
      return !fs.readFileSync(path.join(HOOKS_DIR, f), "utf8").includes('namespace: "');
    });
    assert.deepStrictEqual(bare, [],
      "these adapters call createPidResolver but never build a cache context — migrate them or add an explicit exemption with a reason");
  });

  it("exemptions stay honest — an exempted file must still be a consumer", () => {
    for (const f of EXEMPT) {
      const p = path.join(HOOKS_DIR, f);
      assert.ok(fs.existsSync(p), `${f} exempted but missing`);
      assert.ok(fs.readFileSync(p, "utf8").includes("createPidResolver("), `${f} exempted but no longer a consumer — drop the exemption`);
    }
  });
});
