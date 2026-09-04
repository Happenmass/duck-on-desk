"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const createTheme = require("../scripts/create-theme");

const cleanupDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-create-theme-"));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanupDirs.length) {
    fs.rmSync(cleanupDirs.pop(), { recursive: true, force: true });
  }
});

describe("create-theme defaults", () => {
  it("resolves the platform-specific user themes directory", () => {
    assert.strictEqual(
      createTheme.getDefaultThemesRoot("win32", { APPDATA: "C:\\Users\\Ruller\\AppData\\Roaming" }, "C:\\Users\\Ruller"),
      path.win32.join("C:\\Users\\Ruller\\AppData\\Roaming", "duck-on-desk", "themes")
    );
    assert.strictEqual(
      createTheme.getDefaultThemesRoot("darwin", {}, "/Users/ruller"),
      "/Users/ruller/Library/Application Support/duck-on-desk/themes"
    );
    assert.strictEqual(
      createTheme.getDefaultThemesRoot("linux", { XDG_CONFIG_HOME: "/tmp/config-home" }, "/home/ruller"),
      "/tmp/config-home/duck-on-desk/themes"
    );
  });

  it("slugifies theme ids into filesystem-safe names", () => {
    assert.strictEqual(createTheme.slugifyThemeId("Pixel Cat!"), "pixel-cat");
    assert.strictEqual(createTheme.slugifyThemeId("   "), "my-theme");
  });
});
