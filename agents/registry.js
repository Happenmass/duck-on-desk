// Agent registry — loads all agent configs, provides lookup API
// Used by main.js for process detection and session tracking

const claudeCode = require("./claude-code");
const codex = require("./codex");
const opencode = require("./opencode");
const pi = require("./pi");

const AGENTS = [claudeCode, codex, opencode, pi];
const AGENT_MAP = new Map(AGENTS.map((a) => [a.id, a]));

function namesForPlatform(agent, field) {
  const namesByPlatform = agent[field] || {};
  const isWin = process.platform === "win32";
  const isLinux = process.platform === "linux";
  return isWin
    ? (namesByPlatform.win || [])
    : isLinux
      ? (namesByPlatform.linux || namesByPlatform.mac || [])
      : (namesByPlatform.mac || []);
}

function collectProcessNames(field) {
  const result = [];
  for (const agent of AGENTS) {
    const names = namesForPlatform(agent, field);
    for (const name of names) result.push({ name, agentId: agent.id });
  }
  return result;
}

module.exports = {
  getAllAgents: () => AGENTS,
  getAgent: (id) => AGENT_MAP.get(id),
  getAllProcessNames: () => collectProcessNames("processNames"),
  getStartupRecoveryProcessNames: () => collectProcessNames("startupRecoveryProcessNames"),
};
