"use strict";
const path = require("node:path");
const sourceCache = path.join(__dirname, "policy-cache.js");
// electron-builder places this shared source in extraResources, excluding it
// from app.asar; standalone MCP and the renderer must load that same file.
const cache = require(require("node:fs").existsSync(sourceCache)
  ? sourceCache : path.resolve(__dirname, "../../../../robot-lab-mcp/policy-cache.cjs"));
const { SCHEME, resolvePolicyRequest, ensureCachedPolicy } = cache;
// Electron wiring: call registerScheme() before app.whenReady(), installHandler() inside it.
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
  } }]);
}

function installHandler(protocol, net, pathToFileURL, { bundledDir = null, resolveLabPolicy = null } = {}) {
  protocol.handle(SCHEME, async (request) => {
    let resolved = resolvePolicyRequest(request.url, { bundledDir, resolveLabPolicy });
    if (resolved.status !== 200) {
      try { await ensureCachedPolicy(request.url); }
      catch { return new Response('模型下载失败，请检查网络后重新打开窗口。', { status: 502 }); }
      resolved = resolvePolicyRequest(request.url, { bundledDir, resolveLabPolicy });
    }
    if (resolved.status !== 200) return new Response(resolved.reason || "not found", { status: 404 });
    return net.fetch(pathToFileURL(resolved.file).toString());
  });
}

module.exports = { ...cache, registerScheme, installHandler };
