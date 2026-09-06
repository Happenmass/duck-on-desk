"use strict";
// Every `path.join(__dirname, ...)` literal in src/ must resolve on disk. The
// 2026-09-06 split of src/ into shell/state/robots moved files one or two
// directories deeper; the unit suite stubs BrowserWindow, so a wrong depth in a
// window/preload/asset path only shows up as ERR_FILE_NOT_FOUND at runtime.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
// Dangling before the split (the about dialog's hero art was dropped with the
// sprite themes in 1b37c8d); listed so this test guards new breakage only.
const KNOWN_MISSING = new Set(["assets/svg/duck-about-hero.svg"]);

function walk(dir) {
  return fs.readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

test("every __dirname-relative file literal in src/ points at an existing file", () => {
  const missing = [];
  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, "utf8");
    const re = /path\.join\(\s*__dirname\s*,\s*((?:"[^"]+"\s*,\s*)*"[^"]+\.(?:html|js|mjs|css|png|ico|icns|svg|wav|mp3|json)")\s*\)/g;
    let m;
    while ((m = re.exec(source))) {
      const segments = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
      const target = path.resolve(path.dirname(file), ...segments);
      const rel = path.relative(path.join(SRC, ".."), target);
      if (!fs.existsSync(target) && !KNOWN_MISSING.has(rel)) missing.push(`${path.relative(SRC, file)} -> ${rel}`);
    }
  }
  assert.deepEqual(missing, []);
});
