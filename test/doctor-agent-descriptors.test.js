const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  AGENT_DESCRIPTORS,
  getAgentDescriptor,
  getAgentDescriptors,
} = require("../src/doctor-detectors/agent-descriptors");

describe("doctor agent descriptors", () => {
  it("covers all supported agents", () => {
    assert.deepStrictEqual(
      AGENT_DESCRIPTORS.map((entry) => entry.agentId),
      [
        "claude-code",
        "codex",
        "opencode",
        "pi",
      ]
    );
  });

  it("uses installer-exported default paths", () => {
    const claude = require("../hooks/install");
    const codex = require("../hooks/codex-install");
    const opencode = require("../hooks/opencode-install");
    const pi = require("../hooks/pi-install");

    assert.strictEqual(getAgentDescriptor("claude-code").parentDir, claude.DEFAULT_PARENT_DIR);
    assert.strictEqual(getAgentDescriptor("claude-code").configPath, claude.DEFAULT_CONFIG_PATH);

    assert.strictEqual(getAgentDescriptor("codex").parentDir, codex.DEFAULT_PARENT_DIR);
    assert.strictEqual(getAgentDescriptor("codex").configPath, codex.DEFAULT_CONFIG_PATH);
    assert.strictEqual(getAgentDescriptor("codex").supplementary.configPath, codex.DEFAULT_FEATURES_CONFIG);

    assert.strictEqual(getAgentDescriptor("opencode").parentDir, opencode.DEFAULT_PARENT_DIR);
    assert.strictEqual(getAgentDescriptor("opencode").configPath, opencode.DEFAULT_CONFIG_PATH);

    assert.strictEqual(getAgentDescriptor("pi").parentDir, pi.DEFAULT_PARENT_DIR);
    assert.strictEqual(getAgentDescriptor("pi").configPath, pi.DEFAULT_EXTENSION_DIR);
    assert.strictEqual(getAgentDescriptor("pi").marker, pi.EXTENSION_FILE);
    assert.strictEqual(getAgentDescriptor("pi").coreFile, pi.CORE_FILE);
    assert.strictEqual(getAgentDescriptor("pi").markerFile, pi.MARKER_FILE);
  });

  it("returns copies from public accessors", () => {
    const list = getAgentDescriptors();
    list[0].agentId = "mutated";
    assert.strictEqual(getAgentDescriptor("claude-code").agentId, "claude-code");
    assert.strictEqual(getAgentDescriptor("missing"), null);
  });

});
