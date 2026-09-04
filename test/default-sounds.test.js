"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const createThemeContext = require("../src/theme-context");
const themeLoader = require("../src/theme-loader");

const ROOT = path.join(__dirname, "..");
const SOUNDS_DIR = path.join(ROOT, "assets", "sounds");

themeLoader.init(path.join(ROOT, "src"));

test("built-in themes resolve completion and confirmation to distinct bundled files", () => {
  for (const themeId of ["duck"]) {
    const theme = themeLoader.loadTheme(themeId, { strict: true });
    const context = createThemeContext(theme, { assetsSoundsDir: SOUNDS_DIR });
    const completeUrl = context.getSoundUrl("complete");
    const confirmUrl = context.getSoundUrl("confirm");

    assert.ok(completeUrl, `${themeId} should resolve a completion sound`);
    assert.ok(confirmUrl, `${themeId} should resolve a confirmation sound`);
    assert.strictEqual(fileURLToPath(completeUrl), path.join(SOUNDS_DIR, "complete.mp3"));
    assert.strictEqual(fileURLToPath(confirmUrl), path.join(SOUNDS_DIR, "confirm.mp3"));
    assert.notStrictEqual(confirmUrl, completeUrl);
  }
});
