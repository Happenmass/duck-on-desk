const assert = require("node:assert");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { minimatch } = require("minimatch");

const pkg = require("../package.json");
const ROOT = path.join(__dirname, "..");

function matchedByAnyGlob(globs, target) {
  return globs.some((g) => minimatch(target, g));
}

describe("package build config", () => {
  describe("repository asset audit", () => {
    it("exposes a Windows-compatible npm audit command", () => {
      assert.strictEqual(
        pkg.scripts["audit:assets"],
        "node scripts/audit-repository-assets.js"
      );
    });

    it("does not match retained source artwork with package globs", () => {
      assert.strictEqual(
        matchedByAnyGlob(pkg.build.files, "assets/source/dock-icon-fullbleed.png"),
        false,
        "assets/source/** must stay outside build.files"
      );
    });

  });

  it("ships project window icons in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("assets/icons/**/*"),
      "build.files should include assets/icons/**/*"
    );
  });

  it("ships agent session icons in packaged builds", () => {
    assert.ok(
      matchedByAnyGlob(pkg.build.files, "assets/icons/agents/claude-code.png"),
      "build.files globs must still cover assets/icons/agents/**"
    );
  });

  it("ships third-party notices in packaged builds", () => {
    assert.ok(
      pkg.build.files.includes("NOTICE.md"),
      "build.files should include NOTICE.md"
    );
  });

  it("unpacks built-in theme assets so the folder can be opened from settings", () => {
    assert.ok(
      pkg.build.asarUnpack.includes("themes/**/*"),
      "asarUnpack should include themes/**/*"
    );
  });

  it("ships and unpacks runtime files required by external hook scripts", () => {
    assert.ok(
      pkg.build.files.includes("hooks/**/*"),
      "build.files should include hooks/**/*"
    );
    assert.ok(
      pkg.build.files.includes("extensions/**/*"),
      "build.files should include extensions/**/*"
    );
    assert.ok(
      pkg.build.files.includes("agents/**/*"),
      "build.files should include agents/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("agents/**/*"),
      "asarUnpack should include agents/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("hooks/**/*"),
      "asarUnpack should include hooks/**/*"
    );
    assert.ok(
      pkg.build.asarUnpack.includes("extensions/**/*"),
      "asarUnpack should include extensions/**/*"
    );
  });

  it("unpacks jsonc-parser for NSIS cleanup scripts executed outside app.asar", () => {
    assert.ok(
      pkg.build.asarUnpack.includes("node_modules/jsonc-parser/**/*"),
      "NSIS runs cleanup-integrations.js from app.asar.unpacked, so opencode JSONC cleanup needs an unpacked dependency"
    );
  });

  describe("target-native Koffi packaging", () => {
    it("pins the reviewed Koffi line and prunes only through the afterPack hook", () => {
      assert.strictEqual(pkg.dependencies.koffi, "2.16.3");
      assert.strictEqual(pkg.build.afterPack, "scripts/after-pack-koffi.js");
      assert.strictEqual(pkg.scripts["audit:native-package"], "node scripts/audit-packaged-native.js");
      assert.strictEqual(pkg.scripts["verify:updater-metadata"], "node scripts/verify-updater-metadata.js");
    });
  });

  describe("Windows architecture targets", () => {
    function getWindowsNsisTarget() {
      const targets = pkg.build.win && pkg.build.win.target;
      return Array.isArray(targets) ? targets.find((target) => target && target.target === "nsis") : null;
    }

    it("builds native Windows installers for x64 and arm64", () => {
      const target = getWindowsNsisTarget();
      assert.ok(target, "build.win.target should include an nsis target");
      assert.deepStrictEqual(
        target.arch.slice().sort(),
        ["x64", "arm64"].slice().sort(),
        "Windows NSIS builds should publish both x64 and ARM64 installers"
      );
    });

    it("uses architecture-specific Windows installer names", () => {
      const artifactName = pkg.build.win && pkg.build.win.artifactName;
      assert.strictEqual(
        typeof artifactName,
        "string",
        "build.win.artifactName should be a string"
      );
      assert.match(
        artifactName,
        /\$\{arch\}/,
        "Windows artifactName must include ${arch} so x64 and ARM64 installers cannot collide"
      );
    });

    it("exposes explicit Windows architecture build scripts", () => {
      assert.strictEqual(pkg.scripts["build:win:x64"], "electron-builder --win nsis:x64");
      assert.strictEqual(pkg.scripts["build:win:arm64"], "electron-builder --win nsis:arm64");
      assert.strictEqual(pkg.scripts["build:win:all"], "electron-builder --win nsis:x64 nsis:arm64");
    });

    it("does not emit a redundant universal Windows installer", () => {
      assert.strictEqual(
        pkg.build.nsis && pkg.build.nsis.buildUniversalInstaller,
        false,
        "Windows releases should publish explicit x64/ARM64 installers, not an extra universal NSIS installer"
      );
    });
  });

  describe("macOS architecture targets", () => {
    function getMacTarget(name) {
      const targets = pkg.build.mac && pkg.build.mac.target;
      return Array.isArray(targets) ? targets.find((target) => target && target.target === name) : null;
    }

    it("builds native macOS DMGs for x64 and arm64", () => {
      const target = getMacTarget("dmg");
      assert.ok(target, "build.mac.target should include a dmg target");
      assert.deepStrictEqual(
        target.arch.slice().sort(),
        ["x64", "arm64"].slice().sort(),
        "macOS builds should publish both x64 and ARM64 DMGs"
      );
    });

    it("builds native macOS updater ZIPs for x64 and arm64", () => {
      const target = getMacTarget("zip");
      assert.ok(target, "build.mac.target should include a zip target");
      assert.deepStrictEqual(
        target.arch.slice().sort(),
        ["x64", "arm64"].slice().sort(),
        "macOS builds should publish both x64 and ARM64 updater ZIPs"
      );
    });

    it("requests explicit ad-hoc signing without disabling hardened runtime", () => {
      assert.strictEqual(
        pkg.build.mac && pkg.build.mac.identity,
        "-",
        "macOS x64 and ARM64 packages must express ad-hoc signing intent; CI gates the final signatures"
      );
      assert.notStrictEqual(
        pkg.build.mac && pkg.build.mac.hardenedRuntime,
        false,
        "do not silence the ad-hoc signing warning by disabling hardened runtime"
      );
    });

    it("uses architecture-specific macOS DMG names without spaces", () => {
      const artifactName = pkg.build.mac && pkg.build.mac.artifactName;
      assert.strictEqual(
        typeof artifactName,
        "string",
        "build.mac.artifactName should be a string"
      );
      assert.match(
        artifactName,
        /\$\{arch\}/,
        "macOS artifactName must include ${arch} so x64 and ARM64 DMGs cannot collide"
      );
      assert.doesNotMatch(
        artifactName,
        /\s/,
        "macOS artifactName should not contain spaces so latest-mac.yml URLs match uploaded DMG assets"
      );
    });
  });

  // Windows shell consumers need a physical icon resource outside app.asar.
  // extraResources provides that canonical runtime copy; the packaged EXE
  // embeds the same build.win.icon and is the fallback if the copy is missing.
  describe("Windows shell icon fallback chain", () => {
    it("has the source icon.ico on disk", () => {
      const src = path.join(ROOT, "assets", "icon.ico");
      assert.ok(fs.existsSync(src), "assets/icon.ico must exist for build.win.icon + extraResources");
    });

    it("copies icon.ico into resourcesPath via extraResources", () => {
      const extra = pkg.build.extraResources || [];
      const copied = extra.some(
        (e) => e && e.from === "assets/icon.ico" && e.to === "icon.ico"
      );
      assert.ok(copied, "build.extraResources must copy assets/icon.ico → icon.ico (shell fallback 1)");
    });

    it("wires win.icon to the same source file", () => {
      assert.strictEqual(
        pkg.build.win && pkg.build.win.icon,
        "assets/icon.ico",
        "build.win.icon should point at the same file the shell icon chain expects"
      );
      for (const key of ["installerIcon", "uninstallerIcon", "installerHeaderIcon"]) {
        assert.strictEqual(
          pkg.build.nsis && pkg.build.nsis[key],
          "assets/icon.ico",
          `build.nsis.${key} should use the canonical Windows icon`
        );
      }
    });

    it("does not duplicate the shell icon inside app.asar", () => {
      assert.strictEqual(
        matchedByAnyGlob(pkg.build.files, "assets/icon.ico"),
        false,
        "assets/icon.ico should be packaged only once via extraResources"
      );
    });
  });

  describe("packaging surface and release CI gates", () => {
    it("starts directly without fetching an external binary", () => {
      assert.strictEqual(pkg.scripts.start, "node launch.js");
    });

    it("contains no retired scripts, prebuild hooks, or extraResources", () => {
      for (const key of [
        "fetch:sidecars",
        "verify:sidecars",
        "assert:packaged-sidecar",
        "prebuild",
        "prebuild:win:x64",
        "prebuild:win:arm64",
        "prebuild:linux",
        "prebuild:all",
      ]) {
        assert.equal(pkg.scripts[key], undefined, key);
      }
      // The surviving prebuild hooks build the 3D renderer bundle and stage the
      // duck's ONNX policies (pinned Hugging Face sources, see
      // scripts/fetch-policies.js) -- no sidecar binaries, nothing else.
      for (const key of ["prebuild:mac", "prebuild:mac:arm64", "prebuild:mac:x64", "prebuild:win:all"]) {
        assert.strictEqual(pkg.scripts[key], "npm run build:renderer && npm run fetch:policies", key);
      }
      for (const platform of ["win", "mac", "linux"]) {
        const entries = pkg.build[platform] && pkg.build[platform].extraResources;
        assert.equal(entries, undefined, `${platform} should not package an extra sidecar`);
      }
      // MCP runs under system Node, so its scripts and dependencies must live outside asar.
      assert.deepEqual(pkg.build.extraResources, [
        { from: "assets/icon.ico", to: "icon.ico" },
        {
          from: "mcp/robot-lab", to: "robot-lab-mcp",
          filter: ["package.json", "server.mjs", "check.mjs", "store.mjs", "templates.mjs", "worker.py", "docs/**/*", "jobs.cjs", "training/**/*", "presets/stable-flat-walk/**/*", "presets/official-finetune/**/*", "!training/**/__pycache__/**/*", "!training/**/*.pyc"],
        },
        { from: "mcp/robot-lab/node_modules", to: "robot-lab-mcp/node_modules", filter: ["**/*", "!.cache/**/*"] },
      ]);
    });

    it("declares the asar inspector directly and keeps the macOS + Windows build commands", () => {
      assert.match(pkg.devDependencies["@electron/asar"], /^\^3\./);
      assert.strictEqual(pkg.scripts["build:mac:x64"], "electron-builder --mac dmg:x64 zip:x64");
      assert.strictEqual(pkg.scripts["build:mac:arm64"], "electron-builder --mac dmg:arm64 zip:arm64");
      assert.strictEqual(pkg.scripts["build:all"], "electron-builder --mac --win");
      for (const key of ["build:linux", "build:linux:x64"]) {
        assert.equal(pkg.scripts[key], undefined, key);
      }
      assert.equal(pkg.build.linux, undefined, "Linux is no longer a build target");
    });

    it("release CI carries no retired sidecar fetch or assertion steps", () => {
      const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "build.yml"), "utf8");
      assert.doesNotMatch(workflow, /fetch:sidecars|verify-sidecar|assert:packaged-sidecar/);
    });

  });
});
