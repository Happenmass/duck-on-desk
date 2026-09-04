"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  listIdleVisualOptions,
  resolveIdleVisualChoice,
  humanizeIdleVisualLabel,
} = require("../src/idle-visual");

function makeTheme(overrides = {}) {
  return {
    _id: "duck",
    states: { idle: ["duck-idle-follow.svg"] },
    idleAnimations: [
      { file: "duck-idle-look.svg", duration: 6500 },
      { file: "duck-idle-bubble.svg", duration: 13500 },
      { file: "duck-idle-reading.svg", duration: 14000 },
    ],
    ...overrides,
  };
}

describe("listIdleVisualOptions", () => {
  it("lists the theme default first, then idle pool entries", () => {
    const options = listIdleVisualOptions(makeTheme());
    assert.deepStrictEqual(options, [
      { file: "duck-idle-follow.svg", isThemeDefault: true },
      { file: "duck-idle-look.svg", isThemeDefault: false },
      { file: "duck-idle-bubble.svg", isThemeDefault: false },
      { file: "duck-idle-reading.svg", isThemeDefault: false },
    ]);
  });

  it("includes extra states.idle files and dedupes pool repeats", () => {
    const options = listIdleVisualOptions(makeTheme({
      states: { idle: ["a.svg", "b.svg"] },
      idleAnimations: [{ file: "b.svg", duration: 1000 }, { file: "c.svg", duration: 1000 }],
    }));
    assert.deepStrictEqual(options.map((o) => o.file), ["a.svg", "b.svg", "c.svg"]);
    assert.deepStrictEqual(options.map((o) => o.isThemeDefault), [true, false, false]);
  });

  it("skips malformed entries and tolerates missing collections", () => {
    assert.deepStrictEqual(listIdleVisualOptions(null), []);
    assert.deepStrictEqual(listIdleVisualOptions({}), []);
    const options = listIdleVisualOptions(makeTheme({
      idleAnimations: [null, { file: "" }, { duration: 5 }, { file: "ok.svg" }],
    }));
    assert.deepStrictEqual(options.map((o) => o.file), ["duck-idle-follow.svg", "ok.svg"]);
  });

  it("does not expose conditional easter eggs as persistent idle choices", () => {
    const options = listIdleVisualOptions(makeTheme({
      idleEasterEggs: [{
        file: "duck-outlaw-bender.svg",
        duration: 15000,
        chance: 0.05,
        cooldownMs: 1800000,
        requiresAccessories: { head: "cowboy-hat", mouth: "cigarette" },
      }],
    }));
    assert.ok(!options.some((option) => option.file === "duck-outlaw-bender.svg"));
  });
});

describe("resolveIdleVisualChoice", () => {
  const theme = makeTheme();

  it("returns the stored file when it is a valid non-default option", () => {
    assert.strictEqual(
      resolveIdleVisualChoice(theme, { duck: "duck-idle-reading.svg" }),
      "duck-idle-reading.svg"
    );
  });

  it("returns null when unset, for other themes, or for unknown files", () => {
    assert.strictEqual(resolveIdleVisualChoice(theme, {}), null);
    assert.strictEqual(resolveIdleVisualChoice(theme, null), null);
    assert.strictEqual(resolveIdleVisualChoice(theme, { calico: "calico-idle.svg" }), null);
    assert.strictEqual(resolveIdleVisualChoice(theme, { duck: "gone.svg" }), null);
    assert.strictEqual(resolveIdleVisualChoice(theme, { duck: 42 }), null);
    assert.strictEqual(resolveIdleVisualChoice(null, { duck: "duck-idle-look.svg" }), null);
  });

  it("treats a stored theme default as unset", () => {
    assert.strictEqual(resolveIdleVisualChoice(theme, { duck: "duck-idle-follow.svg" }), null);
  });

  it("ignores prototype keys", () => {
    const map = Object.create({ duck: "duck-idle-look.svg" });
    assert.strictEqual(resolveIdleVisualChoice(theme, map), null);
  });
});

describe("humanizeIdleVisualLabel", () => {
  it("strips theme prefix and extension, title-cases the rest", () => {
    assert.strictEqual(humanizeIdleVisualLabel("duck-idle-reading.svg", "duck"), "Idle Reading");
    assert.strictEqual(humanizeIdleVisualLabel("calico-idle-stretch.svg", "calico"), "Idle Stretch");
  });

  it("handles files without the theme prefix and odd separators", () => {
    assert.strictEqual(humanizeIdleVisualLabel("look_around.svg", "duck"), "Look Around");
    assert.strictEqual(humanizeIdleVisualLabel("assets/deep/idle-wave.svg", "other"), "Idle Wave");
  });

  it("returns empty string for invalid input", () => {
    assert.strictEqual(humanizeIdleVisualLabel(null, "duck"), "");
    assert.strictEqual(humanizeIdleVisualLabel("", "duck"), "");
  });
});
