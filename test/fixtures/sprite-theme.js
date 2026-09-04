"use strict";

// Sprite-era theme fixtures. themes/duck is now a duck3d theme whose state
// files are intent ids, so the sprite-only modules that remain until Plan 04
// (working/juggling tiers, mini mode, accessories, eye tracking, SVG hit
// geometry) need a real sprite theme to stay covered:
//   crab   - the Plan 01 duck sprite theme (v0.1.0-core themes/duck) plus the
//            48 SVGs it references, under crab/assets/
//   calico - manifest only; its geometry tests never read the APNGs
// theme-loader.init(appDir) derives themes/ and assets/svg/ from appDir/..,
// so pointing it at fixtures/src loads these as *built-in* themes, the same
// trust level the tests were written against.
const path = require("node:path");
const themeLoader = require("../../src/theme-loader");

const FIXTURE_SRC = path.join(__dirname, "src");
const REAL_SRC = path.join(__dirname, "..", "..", "src");
const SPRITE_THEMES_DIR = path.join(__dirname, "themes");
const CRAB_DIR = path.join(SPRITE_THEMES_DIR, "crab");
const CRAB_SVG_DIR = path.join(CRAB_DIR, "assets");

function loadSpriteTheme(themeId, opts) {
  themeLoader.init(FIXTURE_SRC);
  try {
    return themeLoader.loadTheme(themeId, opts);
  } finally {
    themeLoader.init(REAL_SRC);
  }
}

module.exports = { loadSpriteTheme, FIXTURE_SRC, SPRITE_THEMES_DIR, CRAB_DIR, CRAB_SVG_DIR };
