"use strict";

const path = require("path");
const { getAgent } = require("../../agents/registry");
const { getFamilyConfig } = require("../../agents/opencode-family");

const claude = require("../../hooks/install");
const codex = require("../../hooks/codex-install");
const opencode = require("../../hooks/opencode-install");
const pi = require("../../hooks/pi-install");

function agentName(agentId) {
  const agent = getAgent(agentId);
  return agent && agent.name ? agent.name : agentId;
}

function agentEventSource(agentId) {
  const agent = getAgent(agentId);
  return agent && agent.eventSource ? agent.eventSource : "hook";
}

const AGENT_DESCRIPTORS = Object.freeze([
  Object.freeze({
    agentId: "claude-code",
    agentName: agentName("claude-code"),
    eventSource: agentEventSource("claude-code"),
    parentDir: claude.DEFAULT_PARENT_DIR,
    configPath: claude.DEFAULT_CONFIG_PATH,
    configMode: "file",
    autoInstall: true,
    marker: "duck-hook.js",
    nested: true,
  }),
  Object.freeze({
    agentId: "codex",
    agentName: agentName("codex"),
    eventSource: agentEventSource("codex"),
    parentDir: codex.DEFAULT_PARENT_DIR,
    configPath: codex.DEFAULT_CONFIG_PATH,
    configMode: "file",
    autoInstall: true,
    marker: "codex-hook.js",
    nested: true,
    supplementary: {
      key: "hooks",
      configPath: codex.DEFAULT_FEATURES_CONFIG,
    },
  }),
  Object.freeze({
    agentId: "opencode",
    agentName: agentName("opencode"),
    eventSource: agentEventSource("opencode"),
    parentDir: opencode.DEFAULT_PARENT_DIR,
    configPath: opencode.DEFAULT_CONFIG_PATH,
    configMode: "file",
    autoInstall: true,
    // opencode registers a plugin directory, not a command hook script.
    // Detection matches an absolute plugin entry by basename.
    //
    // #825: the global config is a MERGE of config.json → opencode.json →
    // opencode.jsonc (later wins, "plugin" arrays REPLACED not concatenated).
    // configJsonc routes reads through the JSONC parser so a commented config
    // is not misreported as config-corrupt; configCandidates (highest-priority
    // first, from the family registry) makes the doctor validate the MERGED
    // effective plugin view instead of opencode.json alone — otherwise it
    // reports "plugin entry verified" while opencode runs the .jsonc array.
    configJsonc: true,
    configCandidates: Object.freeze(
      getFamilyConfig("opencode").configCandidates.map((name) => path.join(opencode.DEFAULT_PARENT_DIR, name))
    ),
    marker: "opencode-plugin",
    detection: "opencode-plugin",
  }),
  Object.freeze({
    agentId: "pi",
    agentName: agentName("pi"),
    eventSource: agentEventSource("pi"),
    parentDir: pi.DEFAULT_PARENT_DIR,
    configPath: pi.DEFAULT_EXTENSION_DIR,
    configMode: "pi-extension",
    autoInstall: true,
    marker: pi.EXTENSION_FILE,
    coreFile: pi.CORE_FILE,
    markerFile: pi.MARKER_FILE,
  }),
]);

function getAgentDescriptors() {
  return AGENT_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
}

function getAgentDescriptor(agentId) {
  const descriptor = AGENT_DESCRIPTORS.find((entry) => entry.agentId === agentId);
  return descriptor ? { ...descriptor } : null;
}

module.exports = {
  AGENT_DESCRIPTORS,
  getAgentDescriptors,
  getAgentDescriptor,
};
