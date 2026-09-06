const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateTheme } = require("../src/shell/theme-schema");

const themePath = path.join(__dirname, "..", "themes", "duck", "theme.json");

test("duck theme is a duck3d theme whose state files are intent ids", () => {
  const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));
  assert.equal(theme.renderer, "duck3d");
  assert.deepEqual(validateTheme(theme), []);
  for (const [state, files] of Object.entries(theme.states)) {
    const list = Array.isArray(files) ? files : files.files || [];
    for (const f of list) assert.match(f, /^duck-[a-z]+$/, `${state} -> ${f}`);
  }
  assert.deepEqual(theme.eyeTracking.states, ["idle"]);
});

test("visual projection accepts the duck3d channel", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "shell", "displayed-visual-projection.js"), "utf8");
  assert.match(src, /SAFE_CHANNELS = new Set\(\["object", "img", "bridge", "duck3d"\]\)/);
});

test("theme loader skips asset existence checks for duck3d themes", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "shell", "theme-loader.js"), "utf8");
  assert.match(src, /if \(theme\.renderer === "duck3d"\) return \[\];/);
});
