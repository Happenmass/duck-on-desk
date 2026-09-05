"use strict";
// pet-model:// serves the four ONNX policies from the user's Hugging Face cache. Weights are never bundled.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const POLICY_COMMIT = "183f99a40bd7308da3e848de961ed32bb02624a5";
const POLICY_NAMES = new Set([
  "BEST_alpha_walking.onnx", "BEST_alpha_sitstand.onnx", "BEST_alpha_stand.onnx", "alpha_ground_pick.onnx",
]);
const SCHEME = "pet-model";
// Community stilt policies (HannesVonEssen/microduck-stilts on the Hub, snapshot pinned), also
// read from the global HF cache: pet-model://policy/stilts%2F<h>cm%2Fpolicy.onnx
const STILTS_REPO = "models--HannesVonEssen--microduck-stilts";
const STILTS_COMMIT = "5b47fa1ad5c3e6448a6033b772ad4c84cfdae3a9";
const STILT_HEIGHTS_CM = new Set([10, 15, 20, 25, 50, 100, 140, 200]);

function policyDirectory(homeDir = os.homedir()) {
  return path.join(homeDir, ".cache", "huggingface", "microduck-simulator", POLICY_COMMIT, "policies");
}

function stiltsDirectory(homeDir = os.homedir()) {
  return path.join(homeDir, ".cache", "huggingface", "hub", STILTS_REPO, "snapshots", STILTS_COMMIT);
}

function resolvePolicyRequest(url, { homeDir = os.homedir(), exists = fs.existsSync } = {}) {
  let name;
  try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { return { status: 404 }; }
  let file;
  const stilts = /^stilts\/(\d+)cm\/policy\.onnx$/.exec(name);
  if (stilts && STILT_HEIGHTS_CM.has(Number(stilts[1]))) file = path.join(stiltsDirectory(homeDir), `${stilts[1]}cm`, "policy.onnx");
  else if (POLICY_NAMES.has(name)) file = path.join(policyDirectory(homeDir), name);
  else return { status: 404 };
  if (!exists(file)) return { status: 404, reason: "policy missing from global cache" };
  return { status: 200, file };
}

// Electron wiring: call registerScheme() before app.whenReady(), installHandler() inside it.
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
  } }]);
}

function installHandler(protocol, net, pathToFileURL) {
  protocol.handle(SCHEME, (request) => {
    const resolved = resolvePolicyRequest(request.url);
    if (resolved.status !== 200) return new Response(resolved.reason || "not found", { status: 404 });
    return net.fetch(pathToFileURL(resolved.file).toString());
  });
}

module.exports = { SCHEME, POLICY_COMMIT, POLICY_NAMES, STILTS_COMMIT, policyDirectory, stiltsDirectory, resolvePolicyRequest, registerScheme, installHandler };
