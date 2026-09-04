const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const os = require("os");

describe("installer default path exports", () => {
  it("exports default config locations for hook-based agents", () => {
    const home = os.homedir();
    const claude = require("../hooks/install");
    const codex = require("../hooks/codex-install");
    const opencode = require("../hooks/opencode-install");
    const pi = require("../hooks/pi-install");

    assert.strictEqual(claude.DEFAULT_PARENT_DIR, path.join(home, ".claude"));
    assert.strictEqual(claude.DEFAULT_CONFIG_PATH, path.join(home, ".claude", "settings.json"));

    assert.strictEqual(codex.DEFAULT_PARENT_DIR, path.join(home, ".codex"));
    assert.strictEqual(codex.DEFAULT_CONFIG_PATH, path.join(home, ".codex", "hooks.json"));
    assert.strictEqual(codex.DEFAULT_FEATURES_CONFIG, path.join(home, ".codex", "config.toml"));

    assert.strictEqual(opencode.DEFAULT_PARENT_DIR, path.join(home, ".config", "opencode"));
    assert.strictEqual(opencode.DEFAULT_CONFIG_PATH, path.join(home, ".config", "opencode", "opencode.json"));

    assert.strictEqual(pi.DEFAULT_PARENT_DIR, path.join(home, ".pi", "agent"));
    assert.strictEqual(pi.DEFAULT_EXTENSION_DIR, path.join(home, ".pi", "agent", "extensions", "duck-on-desk"));
  });
});
