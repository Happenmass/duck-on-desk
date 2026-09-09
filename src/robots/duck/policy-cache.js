"use strict";
// Policies live in the user's global cache. Missing pinned policies are fetched
// on first use; old bundled installations remain readable for compatibility.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const POLICY_COMMIT = "183f99a40bd7308da3e848de961ed32bb02624a5";
const POLICY_NAMES = new Set([
  "BEST_alpha_walking.onnx", "BEST_alpha_sitstand.onnx", "BEST_alpha_stand.onnx", "alpha_ground_pick.onnx",
  "BEST_roller.onnx", "BEST_roller_crouch.onnx",
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

function resolvePolicyRequest(url, { homeDir = os.homedir(), exists = fs.existsSync, bundledDir = null, resolveLabPolicy = null } = {}) {
  let name;
  try { name = decodeURIComponent(new URL(url).pathname.split("/").pop() || ""); } catch { return { status: 404 }; }
  const lab = /^lab\/(run_[a-f0-9-]{36})\/policy\.onnx$/.exec(name);
  if (lab && resolveLabPolicy) {
    try { return {status:200,file:resolveLabPolicy(lab[1])}; } catch { return {status:404}; }
  }
  let cached;
  let rel;
  const stilts = /^stilts\/(\d+)cm\/policy\.onnx$/.exec(name);
  if (stilts && STILT_HEIGHTS_CM.has(Number(stilts[1]))) {
    rel = path.join("stilts", `${stilts[1]}cm`, "policy.onnx");
    cached = path.join(stiltsDirectory(homeDir), `${stilts[1]}cm`, "policy.onnx");
  } else if (POLICY_NAMES.has(name)) {
    rel = name;
    cached = path.join(policyDirectory(homeDir), name);
  } else {
    return { status: 404 };
  }
  const candidates = bundledDir ? [cached, path.join(bundledDir, rel)] : [cached];
  const file = candidates.find((candidate) => exists(candidate));
  if (!file) return { status: 404, reason: "policy missing from the global cache and the app bundle" };
  return { status: 200, file };
}

const pendingDownloads = new Map();
async function ensureCachedPolicy(url, { homeDir = os.homedir(), fetchImpl = fetch, signal } = {}) {
  const target = resolvePolicyRequest(url, { homeDir, exists: () => true });
  if (target.status !== 200 || fs.existsSync(target.file)) return;
  if (pendingDownloads.has(target.file)) return pendingDownloads.get(target.file);
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const source = name.startsWith('stilts/')
    ? `https://huggingface.co/HannesVonEssen/microduck-stilts/resolve/${STILTS_COMMIT}/${name.slice(7)}`
    : `https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/${POLICY_COMMIT}/app/public/policies/${name}`;
  const operation = (async () => {
    const response = await fetchImpl(source, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100000 || bytes.length > 50000000) throw new Error('Invalid model download size');
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    const temporary = `${target.file}.${require("node:crypto").randomUUID()}.part`;
    try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target.file); }
    finally { fs.rmSync(temporary, { force: true }); }
  })();
  pendingDownloads.set(target.file, operation);
  try { await operation; } finally { pendingDownloads.delete(target.file); }
}

module.exports = { SCHEME, POLICY_COMMIT, POLICY_NAMES, STILTS_COMMIT, STILT_HEIGHTS_CM, policyDirectory, stiltsDirectory, resolvePolicyRequest, ensureCachedPolicy };
