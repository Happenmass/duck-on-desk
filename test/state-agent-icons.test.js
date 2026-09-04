"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { fileURLToPath } = require("url");

const { getAllAgents } = require("../agents/registry");
const { INSTALLABLE_AGENT_IDS } = require("../src/settings-actions-agents");
const {
  ARTWORK_SIZE,
  CONTRAST_TILE_SIZE,
  LOBE_ICONS_OFFICIAL_WEBSITE,
  SOURCE_DIR,
  SOURCE_PROVENANCE,
  calculateContainedSize,
  centerOffset,
  getAlphaBounds,
  getElectronBinary,
  getSourcePath,
  hashFileSource,
  hashSource,
  hashSvgSource,
  prepareArtwork,
  readSourceManifest,
  normalizeTextLineEndings,
  updateSourceManifest,
} = require("../scripts/export-agent-icons");
const {
  AGENT_ICON_DIR,
  getAgentIconPath,
  getAgentIcon,
  getAgentIconUrl,
} = require("../src/state-agent-icons");

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.strictEqual(buffer.toString("ascii", 1, 4), "PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  assert.strictEqual(bitDepth, 8, `${path.basename(filePath)} should use 8-bit channels`);
  assert.strictEqual(colorType, 6, `${path.basename(filePath)} should be encoded as RGBA`);
  assert.strictEqual(interlace, 0, `${path.basename(filePath)} should not be interlaced`);

  const idatChunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      idatChunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }

  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const encoded = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let encodedOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = encoded[encodedOffset];
    encodedOffset += 1;
    assert.ok(filter >= 0 && filter <= 4, `Unsupported PNG filter ${filter}`);

    for (let x = 0; x < rowBytes; x += 1) {
      const targetIndex = y * rowBytes + x;
      const left = x >= bytesPerPixel ? pixels[targetIndex - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[targetIndex - rowBytes] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[targetIndex - rowBytes - bytesPerPixel]
        : 0;
      const encodedValue = encoded[encodedOffset];
      encodedOffset += 1;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = above;
      if (filter === 3) predictor = Math.floor((left + above) / 2);
      if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      pixels[targetIndex] = (encodedValue + predictor) & 0xff;
    }
  }

  return { width, height, pixels };
}

function shouldCheckRuntimeIconEntry(entry) {
  return entry.isFile() && !entry.name.startsWith(".");
}

function relativeLuminance([red, green, blue]) {
  const channels = [red, green, blue].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function maximumCompositeContrast(png, background) {
  let maximum = 1;
  for (let offset = 0; offset < png.pixels.length; offset += 4) {
    const alpha = png.pixels[offset + 3] / 255;
    if (alpha === 0) continue;
    const composite = [0, 1, 2].map((channel) => Math.round(
      png.pixels[offset + channel] * alpha + background[channel] * (1 - alpha)
    ));
    maximum = Math.max(maximum, contrastRatio(composite, background));
  }
  return maximum;
}

describe("state agent icons", () => {
  it("returns undefined for BrowserWindow menu icons when nativeImage is unavailable", () => {
    assert.strictEqual(getAgentIcon("claude-code"), undefined);
  });

  it("returns null for missing agent ids and icons", () => {
    assert.strictEqual(getAgentIconUrl(null), null);
    assert.strictEqual(getAgentIconUrl(""), null);
    assert.strictEqual(getAgentIconUrl("missing-agent"), null);
    assert.strictEqual(getAgentIconUrl("../claude-code"), null);
  });

  it("returns a file URL for bundled agent icons", () => {
    const iconUrl = getAgentIconUrl("claude-code");

    assert.strictEqual(new URL(iconUrl).protocol, "file:");
    assert.strictEqual(
      path.normalize(fileURLToPath(iconUrl)),
      path.join(AGENT_ICON_DIR, "claude-code.png")
    );
  });

  it("returns the bundled Pi PNG icon", () => {
    const iconUrl = getAgentIconUrl("pi");

    assert.strictEqual(new URL(iconUrl).protocol, "file:");
    assert.strictEqual(
      path.normalize(fileURLToPath(iconUrl)),
      path.join(AGENT_ICON_DIR, "pi.png")
    );
    assert.strictEqual(getAgentIconPath("pi"), path.join(AGENT_ICON_DIR, "pi.png"));
  });

  it("has canonical runtime PNG icons for every registered agent", () => {
    const runtimeIconFiles = new Set(
      fs.readdirSync(AGENT_ICON_DIR, { withFileTypes: true })
        .filter(shouldCheckRuntimeIconEntry)
        .map((entry) => entry.name)
    );

    for (const agent of getAllAgents()) {
      assert.ok(
        runtimeIconFiles.has(`${agent.id}.png`),
        `Missing exact runtime PNG icon for ${agent.id}`
      );
    }
    assert.deepStrictEqual(
      [...runtimeIconFiles].sort(),
      getAllAgents().map((agent) => `${agent.id}.png`).sort(),
      "Runtime icon directory should exactly match the agent registry"
    );
  });

  it("resolves an icon URL for every installable agent", () => {
    for (const agentId of INSTALLABLE_AGENT_IDS) {
      const iconUrl = getAgentIconUrl(agentId);
      assert.ok(iconUrl, `Missing agent icon URL for ${agentId}`);
      assert.strictEqual(
        path.normalize(fileURLToPath(iconUrl)),
        path.join(AGENT_ICON_DIR, `${agentId}.png`),
      );
    }
  });

  it("keeps runtime agent PNG icons at 64x64", () => {
    for (const entry of fs.readdirSync(AGENT_ICON_DIR, { withFileTypes: true })) {
      if (!shouldCheckRuntimeIconEntry(entry)) continue;
      assert.strictEqual(
        path.extname(entry.name).toLowerCase(),
        ".png",
        `${entry.name} should not be stored in the runtime icon directory`
      );
      const iconPath = path.join(AGENT_ICON_DIR, entry.name);
      const size = readPngSize(iconPath);
      assert.deepStrictEqual(size, { width: 64, height: 64 }, `${entry.name} should be 64x64`);
    }
  });

  it("exports centered RGBA artwork inside the 56x56 safe area", () => {
    for (const agent of getAllAgents()) {
      const iconPath = path.join(AGENT_ICON_DIR, `${agent.id}.png`);
      const png = decodeRgbaPng(iconPath);
      const analysis = getAlphaBounds(png.pixels, png.width, png.height);
      const bounds = analysis.bounds;
      assert.ok(bounds, `${agent.id} should have visible artwork`);
      assert.ok(analysis.hasTransparency, `${agent.id} should use a transparent canvas`);
      if (SOURCE_PROVENANCE[agent.id].exportMode === "passthrough") continue;
      assert.ok(bounds.width <= ARTWORK_SIZE, `${agent.id} exceeds the safe-area width`);
      assert.ok(bounds.height <= ARTWORK_SIZE, `${agent.id} exceeds the safe-area height`);

      const leftPadding = bounds.x;
      const rightPadding = png.width - bounds.x - bounds.width;
      const topPadding = bounds.y;
      const bottomPadding = png.height - bounds.y - bounds.height;
      assert.ok(leftPadding >= 4 && rightPadding >= 4, `${agent.id} lacks horizontal padding`);
      assert.ok(topPadding >= 4 && bottomPadding >= 4, `${agent.id} lacks vertical padding`);
      assert.ok(Math.abs(leftPadding - rightPadding) <= 1, `${agent.id} is not horizontally centered`);
      assert.ok(Math.abs(topPadding - bottomPadding) <= 1, `${agent.id} is not vertically centered`);
    }
  });

  it("keeps every agent identifiable on actual light and dark UI backgrounds", () => {
    const backgrounds = {
      "session HUD dark": [0x20, 0x20, 0x24],
      "dashboard surface-alt dark": [0x18, 0x18, 0x1b],
      "dashboard surface dark": [0x23, 0x23, 0x27],
      white: [0xff, 0xff, 0xff],
    };

    const failures = [];
    for (const agent of getAllAgents()) {
      const png = decodeRgbaPng(path.join(AGENT_ICON_DIR, `${agent.id}.png`));
      for (const [backgroundName, background] of Object.entries(backgrounds)) {
        const ratio = maximumCompositeContrast(png, background);
        if (ratio < 3) {
          failures.push(`${agent.id} reaches only ${ratio.toFixed(2)}:1 on ${backgroundName}`);
        }
      }
    }
    assert.deepStrictEqual(failures, []);
  });

  it("uses centered neutral tiles only for low-contrast variants", () => {
    const expected = {
      codex: "neutral-light-tile",
      opencode: "neutral-light-tile",
      pi: "neutral-light-tile",
    };
    const actual = Object.fromEntries(
      Object.entries(SOURCE_PROVENANCE)
        .filter(([, provenance]) => provenance.contrastTreatment)
        .map(([agentId, provenance]) => [agentId, provenance.contrastTreatment])
    );
    assert.deepStrictEqual(actual, expected);

    for (const agentId of Object.keys(expected)) {
      const png = decodeRgbaPng(path.join(AGENT_ICON_DIR, `${agentId}.png`));
      const bounds = getAlphaBounds(png.pixels, png.width, png.height).bounds;
      assert.deepStrictEqual(
        bounds,
        { x: 4, y: 4, width: CONTRAST_TILE_SIZE, height: CONTRAST_TILE_SIZE },
        `${agentId} should use the centered contrast tile`
      );
    }
  });

  it("preserves aspect ratio while containing artwork", () => {
    assert.deepStrictEqual(calculateContainedSize(1200, 600), { width: 56, height: 28 });
    assert.deepStrictEqual(calculateContainedSize(600, 1200), { width: 28, height: 56 });
    assert.deepStrictEqual(calculateContainedSize(640, 640), { width: 56, height: 56 });
    assert.deepStrictEqual(calculateContainedSize(32, 24), { width: 32, height: 24 });
    assert.strictEqual(centerOffset(64, 56), 4);
    assert.strictEqual(centerOffset(64, 35), 14);
  });

  it("keeps an opaque source's complete canvas instead of alpha-cropping", () => {
    const width = 120;
    const height = 60;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let offset = 3; offset < bitmap.length; offset += 4) bitmap[offset] = 255;
    let cropCalled = false;
    let resizeOptions = null;
    const resized = { isEmpty: () => false };
    const image = {
      getSize: () => ({ width, height }),
      toBitmap: () => bitmap,
      crop: () => {
        cropCalled = true;
        return image;
      },
      resize: (options) => {
        resizeOptions = options;
        return resized;
      },
    };

    const artwork = prepareArtwork(image);
    assert.strictEqual(cropCalled, false);
    assert.strictEqual(artwork.hadTransparency, false);
    assert.deepStrictEqual(artwork.sourceBounds, { x: 0, y: 0, width, height });
    assert.deepStrictEqual(artwork.targetSize, { width: 56, height: 28 });
    assert.deepStrictEqual(resizeOptions, { width: 56, height: 28, quality: "best" });
    assert.strictEqual(artwork.resized, resized);
  });

  it("ignores local dotfiles and directories when checking runtime icon dimensions", () => {
    const entries = [
      { name: ".DS_Store", isFile: () => true },
      { name: "scratch", isFile: () => false },
      { name: "codex.png", isFile: () => true },
    ];

    assert.deepStrictEqual(
      entries
        .filter(shouldCheckRuntimeIconEntry)
        .map((entry) => entry.name),
      ["codex.png"]
    );
  });

  it("normalizes SVG source line endings before hashing", () => {
    assert.strictEqual(
      normalizeTextLineEndings("<svg>\r\n  <path />\r\n</svg>\r"),
      "<svg>\n  <path />\n</svg>\n"
    );

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "duck-svg-hash-"));
    try {
      const lfPath = path.join(tempDir, "lf.svg");
      const crlfPath = path.join(tempDir, "crlf.svg");
      fs.writeFileSync(lfPath, "<svg>\n  <path />\n</svg>\n");
      fs.writeFileSync(crlfPath, "<svg>\r\n  <path />\r\n</svg>\r\n");
      assert.strictEqual(hashSvgSource(crlfPath), hashSvgSource(lfPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves the real Electron binary for the exporter entrypoint", () => {
    const electronBinary = getElectronBinary();
    assert.ok(path.isAbsolute(electronBinary), "Electron binary path should be absolute");
    if (process.platform === "win32") {
      assert.strictEqual(path.basename(electronBinary).toLowerCase(), "electron.exe");
    }
  });

  it("returns the cached URL value for repeated lookups", () => {
    const first = getAgentIconUrl("codex");
    const second = getAgentIconUrl("codex");

    assert.strictEqual(second, first);
  });
});
