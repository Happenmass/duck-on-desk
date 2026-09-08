"use strict";

function command(method) {
  const action = async (payload, deps = {}) => {
    if (!payload || typeof payload.agentId !== "string") return { status: "error", message: "agentId is required" };
    if (!deps.agentMcpManager) return { status: "error", message: "MCP installer is unavailable" };
    try { return await deps.agentMcpManager[method](payload.agentId, payload.pythonPath); }
    catch (error) { return { status: "error", message: error.message }; }
  };
  // Serialize with the existing Codex/OpenCode hook configuration writers.
  action.lockKey = "agentIntegration";
  return action;
}
module.exports = {
  openRobotLab: async (_payload, deps) => { if (deps.snapshot?.developerMode !== true) return {status:"error",message:"Enable developer mode in Settings → About first"}; if (!deps.openRobotLab) return {status:"error",message:"Robot Lab unavailable"}; deps.openRobotLab(); return {status:"ok"}; },
  getAgentMcpStatus: command("inspect"),
  installAgentMcp: command("install"),
  removeAgentMcp: command("remove"),
};
