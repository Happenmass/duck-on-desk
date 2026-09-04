"use strict";

// JSONC install matrix for opencode-family members with jsonc: true. Exercises
// the REAL thin installer (makeFamilyInstaller → opencode-family-jsonc.js)
// against real temp files — the plan §4.1 contract: element-level edits that
// PRESERVE user comments and trailing commas, JSON-branch-identical return
// shapes, unregister removes ALL exact matches (high index → low), and corrupt
// input never gets clobbered.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

function parseJsonc(text) {
  // eslint-disable-next-line global-require
  const { parse } = require("jsonc-parser");
  const errors = [];
  const tree = parse(text, errors, { allowTrailingComma: true });
  assert.deepStrictEqual(errors, [], "fixture/output must stay valid JSONC");
  return tree;
}

// ---------------------------------------------------------------------------
// #825 — opencode merged-config matrix.
//
// opencode's global config is a MERGE of config.json → opencode.json →
// opencode.jsonc (later wins, "plugin" arrays REPLACED not concatenated;
// verified against opencode 1.18.3 via an isolated XDG_CONFIG_HOME +
// `opencode debug config`). Before #825 the installer wrote opencode.json
// unconditionally, so any opencode.jsonc declaring "plugin" silently killed
// the registration while Settings and Doctor both reported success.
//
// Structural difference from mimocode worth locking: opencode's create-default
// (opencode.json) is NOT its highest-priority candidate (opencode.jsonc is).
// ---------------------------------------------------------------------------
describe("opencode JSONC installer — merged config semantics (#825)", () => {
  // eslint-disable-next-line global-require
  const { registerOpencodePlugin, unregisterOpencodePlugin } = require("../hooks/opencode-install");
  // eslint-disable-next-line global-require
  const { getFamilyConfig } = require("../agents/opencode-family");
  const OC_PLUGIN_DIR = "/abs/hooks/opencode-plugin";

  function ocDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "clawd-opencode-merged-"));
  }
  function inDir(dir, name, text) {
    const p = path.join(dir, name);
    if (text !== undefined) fs.writeFileSync(p, text);
    return p;
  }
  // The installer derives siblings from dirname(configPath); the create-default
  // basename is what a real install passes.
  function defaultConfigPath(dir) {
    return path.join(dir, "opencode.json");
  }

  it("candidate order matches what opencode actually resolves (highest priority first)", () => {
    assert.deepStrictEqual(
      [...getFamilyConfig("opencode").configCandidates],
      ["opencode.jsonc", "opencode.json", "config.json"],
      "order is load-bearing: the LAST file to declare plugin wins in opencode, so we must edit .jsonc first"
    );
    assert.strictEqual(getFamilyConfig("opencode").jsonc, true);
    assert.strictEqual(
      getFamilyConfig("opencode").configFileName,
      "opencode.json",
      "create-default stays opencode.json even though it is not the top candidate"
    );
  });

  it("#825 repro: edits opencode.jsonc when BOTH declare plugin, leaving opencode.json untouched", () => {
    const dir = ocDir();
    const jsonText = '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugin": ["@vendor/in-json"]\n}';
    const jsonPath = inDir(dir, "opencode.json", jsonText);
    const jsoncPath = inDir(dir, "opencode.jsonc", '{\n  // the file opencode actually runs\n  "plugin": ["@vendor/in-jsonc"],\n}');

    const res = registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });

    assert.strictEqual(res.added, true);
    assert.strictEqual(res.configPath, jsoncPath, "must edit the file whose plugin array wins, not the create-default");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, ["@vendor/in-jsonc", OC_PLUGIN_DIR]);
    assert.strictEqual(fs.readFileSync(jsonPath, "utf8"), jsonText, "opencode.json must stay byte-identical");
    assert.ok(fs.readFileSync(jsoncPath, "utf8").includes("// the file opencode actually runs"), "comments preserved");
  });

  it("edits opencode.json when opencode.jsonc exists WITHOUT a plugin key (never masks live plugins)", () => {
    const dir = ocDir();
    const jsonPath = inDir(dir, "opencode.json", '{\n  "plugin": ["@vendor/live"]\n}');
    const jsoncText = '{\n  // model prefs only — no plugin key, so .json still wins\n  "model": "anthropic/claude-sonnet-4-6",\n}';
    const jsoncPath = inDir(dir, "opencode.jsonc", jsoncText);

    const res = registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });

    assert.strictEqual(res.configPath, jsonPath, "adding a plugin key to .jsonc here would KILL the user's .json plugins");
    assert.strictEqual(fs.readFileSync(jsoncPath, "utf8"), jsoncText, "opencode.jsonc must stay byte-identical");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, ["@vendor/live", OC_PLUGIN_DIR]);
  });

  it("edits an existing opencode.jsonc instead of CREATING a masked opencode.json", () => {
    const dir = ocDir();
    const jsoncPath = inDir(dir, "opencode.jsonc", '{\n  "plugin": ["@vendor/only"],\n}');
    const configPath = defaultConfigPath(dir); // does not exist

    const res = registerOpencodePlugin({ silent: true, configPath, pluginDir: OC_PLUGIN_DIR });

    assert.strictEqual(res.configPath, jsoncPath);
    assert.strictEqual(res.created, false);
    assert.ok(!fs.existsSync(configPath), "creating opencode.json here would be born dead — .jsonc outranks it");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, ["@vendor/only", OC_PLUGIN_DIR]);
  });

  it("supports the legacy config.json tier as the effective owner", () => {
    const dir = ocDir();
    const legacyPath = inDir(dir, "config.json", '{\n  "plugin": ["@vendor/legacy"]\n}');
    const res = registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });
    assert.strictEqual(res.configPath, legacyPath);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(legacyPath, "utf8")).plugin, ["@vendor/legacy", OC_PLUGIN_DIR]);
  });

  it("still creates opencode.json fresh (with opencode's $schema) when no candidate exists", () => {
    const dir = ocDir();
    const configPath = defaultConfigPath(dir);
    const res = registerOpencodePlugin({ silent: true, configPath, pluginDir: OC_PLUGIN_DIR });
    assert.strictEqual(res.created, true);
    assert.strictEqual(res.configPath, configPath, "fresh installs keep landing in opencode.json");
    const written = parseJsonc(fs.readFileSync(configPath, "utf8"));
    assert.strictEqual(written.$schema, "https://opencode.ai/config.json");
    assert.deepStrictEqual(written.plugin, [OC_PLUGIN_DIR]);
    assert.ok(!fs.existsSync(path.join(dir, "opencode.jsonc")), "must not create a .jsonc users never asked for");
  });

  it("unregister sweeps ALL candidates so a masked entry cannot resurrect", () => {
    const dir = ocDir();
    const jsonPath = inDir(dir, "opencode.json", `{\n  "plugin": ["${OC_PLUGIN_DIR}", "@vendor/keep"]\n}`);
    const jsoncPath = inDir(dir, "opencode.jsonc", `{\n  // live\n  "plugin": ["${OC_PLUGIN_DIR}"],\n}`);

    const res = unregisterOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });

    assert.strictEqual(res.removed, 2, "both the live entry and the masked one must go");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, []);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, ["@vendor/keep"]);
  });

  it("uninstall now claims what install claims — stale absolute paths by basename, never npm specifiers", () => {
    const dir = ocDir();
    const jsonPath = inDir(
      dir,
      "opencode.json",
      `{\n  "plugin": ["${OC_PLUGIN_DIR}", "/old/install/opencode-plugin", "opencode-wakatime", "@scope/opencode-plugin"]\n}`
    );
    const res = unregisterOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });
    assert.strictEqual(res.removed, 2);
    assert.deepStrictEqual(
      parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin,
      ["opencode-wakatime", "@scope/opencode-plugin"],
      "package specifiers are not absolute paths and must survive"
    );
  });

  it("a commented opencode.json is now editable instead of being read as corrupt", () => {
    const dir = ocDir();
    const jsonPath = inDir(dir, "opencode.json", '{\n  // opencode parses .json with a JSONC reader too\n  "plugin": ["@vendor/keep"],\n}');
    const res = registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });
    assert.strictEqual(res.configPath, jsonPath);
    assert.ok(fs.readFileSync(jsonPath, "utf8").includes("// opencode parses"), "comment survives the edit");
  });

  it("refuses to edit (fail-closed) when ANY candidate is corrupt — behavior change from the JSON branch", () => {
    const dir = ocDir();
    const jsoncText = "{ this is not json";
    const jsoncPath = inDir(dir, "opencode.jsonc", jsoncText);
    const jsonPath = inDir(dir, "opencode.json", '{\n  "plugin": []\n}');
    assert.throws(
      () => registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR }),
      /Failed to (read|parse)/
    );
    assert.strictEqual(fs.readFileSync(jsoncPath, "utf8"), jsoncText, "corrupt file must not be clobbered");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin, [], "and no partial edit elsewhere");
  });

  it("treats an EMPTY plugin array as a live declaration — it masks just like a full one", () => {
    // Verified against opencode 1.18.3: a `"plugin": []` in opencode.jsonc
    // resolves the merged plugin list to [] — the .json array is REPLACED, not
    // merged. So an empty array is a declaration, not an absence; writing to
    // .json here would be born dead.
    const dir = ocDir();
    const jsonPath = inDir(dir, "opencode.json", '{\n  "plugin": ["@vendor/in-json"]\n}');
    const jsoncPath = inDir(dir, "opencode.jsonc", '{\n  // empty but declared\n  "plugin": [],\n}');

    const res = registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR });

    assert.strictEqual(res.configPath, jsoncPath, "an empty array still owns the effective plugin list");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(jsoncPath, "utf8")).plugin, [OC_PLUGIN_DIR]);
    assert.deepStrictEqual(
      parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin,
      ["@vendor/in-json"],
      "the masked file must not be edited"
    );
  });

  it("fails closed on an UNREADABLE candidate, not just an unparseable one", () => {
    // readCandidates rethrows any non-ENOENT error (EISDIR/EACCES/…). Tolerating
    // them would mean editing around a file we cannot see — exactly how a
    // masking declaration would go unnoticed.
    const dir = ocDir();
    fs.mkdirSync(path.join(dir, "opencode.jsonc")); // candidate is a DIRECTORY → EISDIR
    const jsonPath = inDir(dir, "opencode.json", '{\n  "plugin": ["@vendor/keep"]\n}');

    assert.throws(
      () => registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR }),
      /Failed to read/
    );
    assert.deepStrictEqual(
      parseJsonc(fs.readFileSync(jsonPath, "utf8")).plugin,
      ["@vendor/keep"],
      "no partial edit may land while a candidate is unreadable"
    );
  });

  it("honors options.homeDir so a sandbox home is never written past (symmetry with unregister)", () => {
    // register() used to read os.homedir() directly while unregister() honored
    // options.homeDir — a caller passing a sandbox home silently edited the
    // REAL ~/.config/opencode. Locked in both directions.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-opencode-home-"));
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    const expected = path.join(home, ".config", "opencode", "opencode.json");

    const reg = registerOpencodePlugin({ silent: true, homeDir: home, pluginDir: OC_PLUGIN_DIR });
    assert.strictEqual(reg.configPath, expected, "register must resolve under the sandbox home");
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(expected, "utf8")).plugin, [OC_PLUGIN_DIR]);

    const unreg = unregisterOpencodePlugin({ silent: true, homeDir: home, pluginDir: OC_PLUGIN_DIR });
    assert.strictEqual(unreg.removed, 1);
    assert.deepStrictEqual(parseJsonc(fs.readFileSync(expected, "utf8")).plugin, []);
  });

  it("refuses a config with duplicate top-level plugin keys", () => {
    const dir = ocDir();
    inDir(dir, "opencode.json", '{\n  "plugin": ["a"],\n  "plugin": ["b"]\n}');
    assert.throws(
      () => registerOpencodePlugin({ silent: true, configPath: defaultConfigPath(dir), pluginDir: OC_PLUGIN_DIR }),
      /duplicate top-level "plugin" keys/
    );
  });
});
