"use strict";
// Downloads a market policy into the user's Hugging Face cache.
//
// Integrity comes from the Hub's own file tree rather than from the author's
// manifest: every policy.onnx published under the `microduck-policy` tag is a
// Git LFS object (33 of 33 surveyed 2026-09-16), and an LFS oid *is* the
// sha256 of the file content -- verified against a real download. So the exact
// size and digest are known before a single byte is fetched, and a file that
// does not match them never reaches its final path.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HUB = "https://huggingface.co";
// Observed range is 793 KB to 8.4 MB. These are the sanity bounds applied to
// what the tree API claims, before that claim is trusted at all.
const MIN_POLICY_BYTES = 100000;
const MAX_POLICY_BYTES = 20000000;
const TREE_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const MAX_TREE_BYTES = 1000000;
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function defaultRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ".cache", "huggingface", "duck-market");
}

function split(repo) {
  if (typeof repo !== "string") return null;
  const index = repo.indexOf("/");
  if (index <= 0) return null;
  const owner = repo.slice(0, index);
  const slug = repo.slice(index + 1);
  return NAME.test(owner) && NAME.test(slug) ? { owner, slug } : null;
}

// The on-disk location is keyed by revision, so two revisions of the same
// repository coexist and an installed file can never silently change meaning.
function policyPath(repo, revision, root = defaultRoot()) {
  const parts = split(repo);
  if (!parts || !REVISION.test(revision)) throw new Error("Unknown market policy");
  return path.join(root, parts.owner, parts.slug, revision, "policy.onnx");
}

async function readJson(response, limit) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("Response too large");
  const text = await response.text();
  if (text.length > limit) throw new Error("Response too large");
  return JSON.parse(text);
}

function timeout(ms, signal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

function createInstaller({ root = defaultRoot(), fetchImpl = fetch } = {}) {
  // What the Hub says this revision's policy.onnx is: exact size and digest.
  async function policyMeta(repo, revision, { signal } = {}) {
    const parts = split(repo);
    if (!parts || !REVISION.test(revision)) throw new Error("Unknown market policy");
    const response = await fetchImpl(`${HUB}/api/models/${repo}/tree/${revision}`, { signal: timeout(TREE_TIMEOUT_MS, signal) });
    if (!response.ok) throw new Error(`文件列表读取失败：HTTP ${response.status}`);
    const tree = await readJson(response, MAX_TREE_BYTES);
    if (!Array.isArray(tree)) throw new Error("文件列表格式无法识别");
    const entry = tree.find((item) => item && item.path === "policy.onnx");
    if (!entry) throw new Error("这个版本里没有 policy.onnx");
    const lfs = entry.lfs && typeof entry.lfs === "object" ? entry.lfs : null;
    const size = Number(lfs ? lfs.size : entry.size);
    const sha256 = lfs && typeof lfs.oid === "string" && SHA256.test(lfs.oid) ? lfs.oid : null;
    if (!Number.isInteger(size) || size < MIN_POLICY_BYTES || size > MAX_POLICY_BYTES) {
      throw new Error(`权重体积异常（${size} 字节），已停止下载`);
    }
    return { size, sha256 };
  }

  function installedPath(repo, revision) { return policyPath(repo, revision, root); }
  function isInstalled(repo, revision) {
    try { return fs.statSync(installedPath(repo, revision)).size > 0; } catch { return false; }
  }

  // Downloads and verifies. Returns the cached file path; an existing verified
  // file is reused rather than re-fetched.
  async function install(repo, revision, { signal, expected = null } = {}) {
    const target = installedPath(repo, revision);
    const meta = expected || await policyMeta(repo, revision, { signal });
    if (isInstalled(repo, revision)) {
      const existing = fs.readFileSync(target);
      if (existing.length === meta.size && (!meta.sha256 || digestOf(existing) === meta.sha256)) {
        return { file: target, bytes: existing.length, sha256: meta.sha256 || digestOf(existing), reused: true };
      }
      // A file that no longer matches the revision it is filed under is not a
      // cache hit; replace it rather than serving it.
      fs.rmSync(target, { force: true });
    }

    const response = await fetchImpl(`${HUB}/${repo}/resolve/${revision}/policy.onnx`, { signal: timeout(DOWNLOAD_TIMEOUT_MS, signal) });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== meta.size) throw new Error(`下载的体积与仓库记录不一致（${bytes.length} ≠ ${meta.size}）`);
    const digest = digestOf(bytes);
    if (meta.sha256 && digest !== meta.sha256) throw new Error("下载内容的校验和与仓库记录不一致");

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.part`;
    try {
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
    } finally { fs.rmSync(temporary, { force: true }); }
    return { file: target, bytes: bytes.length, sha256: digest, reused: false };
  }

  function remove(repo, revision) {
    const target = installedPath(repo, revision);
    fs.rmSync(target, { force: true });
    // Leave no empty revision directory behind; the parents may still hold
    // other revisions of the same repository.
    try { fs.rmdirSync(path.dirname(target)); } catch { /* still in use or already gone */ }
  }

  return { policyMeta, install, installedPath, isInstalled, remove, root };
}

function digestOf(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

module.exports = {
  HUB, MIN_POLICY_BYTES, MAX_POLICY_BYTES,
  defaultRoot, policyPath, createInstaller, digestOf,
};
