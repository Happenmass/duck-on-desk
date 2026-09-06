"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadSpriteTheme, SPRITE_THEMES_DIR, CRAB_SVG_DIR } = require("./fixtures/sprite-theme");
const { buildThemeMetadata } = require("../src/shell/theme-metadata");
const {
  collectRequiredAssetFiles,
  projectThemeVisualUsages,
} = require("../src/shell/theme-schema");

// Accessories are sprite-only: measured against the sprite fixtures (crab is
// the former built-in duck sprite theme, calico has no accessories).
const THEMES_DIR = SPRITE_THEMES_DIR;

function readRawTheme(themeId) {
  return JSON.parse(
    fs.readFileSync(path.join(THEMES_DIR, themeId, "theme.json"), "utf8")
  );
}

function capabilityPair(themeId) {
  const raw = readRawTheme(themeId);
  const themeDir = path.join(THEMES_DIR, themeId);
  const metadata = buildThemeMetadata(themeId, raw, true, themeDir);
  const normalized = loadSpriteTheme(themeId, { strict: true });
  return { raw, metadata, normalized };
}

function assertDeclaredTargetsExist(themeId, raw) {
  const files = raw.customization.accessories.files || {};
  for (const [file, descriptor] of Object.entries(files)) {
    const targetId = descriptor.followTarget && descriptor.followTarget.id;
    if (!targetId) continue;
    const localPath = path.join(THEMES_DIR, themeId, "assets", file);
    const assetPath = fs.existsSync(localPath)
      ? localPath
      : path.join(CRAB_SVG_DIR, file);
    const source = fs.readFileSync(assetPath, "utf8");
    assert.ok(
      source.includes(`id="${targetId}"`) || source.includes(`id='${targetId}'`),
      `${themeId}/${file} should contain the exact follow target ${targetId}`
    );
  }
}

describe("built-in accessory capability contracts", () => {
  it("keeps raw metadata and normalized runtime capability aligned", () => {
    for (const [themeId, expected] of [
      ["crab", true],
      ["calico", false],
    ]) {
      const { metadata, normalized } = capabilityPair(themeId);
      assert.strictEqual(metadata.capabilities.accessories, expected, `${themeId} metadata`);
      assert.strictEqual(normalized._capabilities.accessories, expected, `${themeId} runtime`);
      assert.strictEqual(
        metadata.capabilities.accessories,
        normalized._capabilities.accessories,
        `${themeId} raw/normalized parity`
      );
    }
  });

  it("projects every Duck visual usage and verifies its exact dynamic targets", () => {
    const { raw, normalized } = capabilityPair("crab");
    const usages = projectThemeVisualUsages(raw);
    const files = collectRequiredAssetFiles(raw);

    assert.strictEqual(usages.length, 50);
    assert.strictEqual(files.length, 48);
    assert.deepStrictEqual(
      new Set(files),
      new Set(fs.readdirSync(CRAB_SVG_DIR).filter((file) => file.endsWith(".svg"))),
      "every SVG exposed by the animation picker must have an audited attachment policy"
    );
    assert.ok(files.includes("duck-outlaw-bender.svg"));
    assert.ok(files.includes("duck-working-typing-boss.svg"));
    assert.ok(!usages.some((usage) => usage.file === "duck-working-typing-boss.svg"));
    assert.ok(!usages.some((usage) => usage.source === "rendering.objectChannelFiles"));
    assert.strictEqual(normalized._capabilities.accessories, true);
    assertDeclaredTargetsExist("crab", raw);

    for (const hidden of [
      "duck-error.svg",
      "duck-collapse-sleep.svg",
      "duck-wake.svg",
      "duck-mini-enter-sleep.svg",
      "duck-mini-sleep.svg",
    ]) {
      assert.strictEqual(raw.customization.accessories.files[hidden].visibility, "hidden");
      assert.ok(usages.some((usage) => usage.file === hidden), `${hidden} should be reachable`);
    }

    const buildingTier = raw.workingTiers.find(({ minSessions }) => minSessions === 3);
    assert.deepStrictEqual(buildingTier, {
      minSessions: 3,
      file: "duck-working-building.svg",
    });
    const buildingAccessory =
      raw.customization.accessories.files[buildingTier.file];
    assert.deepStrictEqual(
      buildingAccessory.staticFrame,
      { cx: 7.5, baseY: 1, width: 16 },
      "the 3+ session accessory should sit on top of the built-in safety helmet"
    );
    assert.strictEqual(buildingAccessory.followTarget.id, "accessory-anchor");
    assert.deepStrictEqual(
      buildingAccessory.followTarget.frame,
      buildingAccessory.staticFrame
    );
    const headphonesTier = raw.workingTiers.find(({ minSessions }) => minSessions === 2);
    assert.deepStrictEqual(headphonesTier, {
      minSessions: 2,
      file: "duck-headphones-groove.svg",
    });
    assert.deepStrictEqual(
      raw.customization.accessories.files[headphonesTier.file],
      { visibility: "hidden" },
      "the headphones sprite should never add a head accessory"
    );
    for (const tier of raw.workingTiers.filter(({ minSessions }) => minSessions !== 2)) {
      assert.notStrictEqual(
        raw.customization.accessories.files[tier.file].visibility,
        "hidden",
        `${tier.minSessions}-session working accessories should remain visible`
      );
    }
    assert.deepStrictEqual(raw.fileHitBoxes["duck-working-typing.svg"], {
      x: -2, y: -7, w: 20, h: 24,
    });
    assert.strictEqual(
      raw.fileHitBoxes["duck-headphones-groove.svg"],
      undefined,
      "the 2-session base hitbox must not reserve empty accessory space"
    );
    assert.deepStrictEqual(raw.fileHitBoxes["duck-working-building.svg"], {
      x: -1, y: -2, w: 17, h: 19,
    });

    const sleeping = raw.customization.accessories.files["duck-sleeping.svg"];
    assert.deepStrictEqual(sleeping.staticFrame, { cx: 7.5, baseY: 10, width: 16 });
    assert.strictEqual(sleeping.followTarget.id, "torso-sploot");
    assert.deepStrictEqual(sleeping.followTarget.frame, sleeping.staticFrame);
  });

  it("anchors Duck idle accessories inside the breathing transform", () => {
    const raw = readRawTheme("crab");
    const idleDescriptor =
      raw.customization.accessories.files["duck-idle-follow.svg"];
    assert.strictEqual(idleDescriptor.followTarget.id, "torso");

    const source = fs.readFileSync(
      path.join(CRAB_SVG_DIR, "duck-idle-follow.svg"),
      "utf8"
    );
    assert.match(
      source,
      /<g class="breathe-anim">[\s\S]*?<rect id="torso"/,
      "the exact target must inherit the visible body's breathing transform"
    );
  });

});
