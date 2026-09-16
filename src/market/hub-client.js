"use strict";
// Aggregates the Microduck policy market from the Hugging Face Hub.
//
// Discovery is one request: `?full=true` returns each repository's current
// revision (`sha`) and file list (`siblings`), which is enough to render the
// listing and to tell -- before fetching any weights -- whether a repository
// even has a policy.onnx. Manifests are then read at that pinned revision, so a
// cached manifest can never drift from the listing it describes.
//
// Tags are how repositories are found, never why they are trusted: anyone can
// apply one. Trust comes from the local evaluation the app runs later.
const fs = require("node:fs");
const path = require("node:path");

const HUB = "https://huggingface.co";
const TAG = "microduck-policy";
const LIST_TIMEOUT_MS = 20000;
const MANIFEST_TIMEOUT_MS = 10000;
const MAX_LIST_BYTES = 4000000;
const MAX_MANIFEST_BYTES = 200000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 5;
const CACHE_VERSION = 1;

function listUrl(limit) {
  return `${HUB}/api/models?filter=${encodeURIComponent(TAG)}&full=true&limit=${limit}`;
}

function manifestUrl(repo, sha) {
  return `${HUB}/${repo}/resolve/${sha}/manifest.json`;
}

// Reads a response body under a ceiling. The Hub is not hostile, but this code
// parses whatever a URL returns, and an unbounded read is an unbounded buffer.
async function readJson(response, limit) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("Response too large");
  const text = await response.text();
  if (text.length > limit) throw new Error("Response too large");
  return JSON.parse(text);
}

// Runs `worker` over `items` with a fixed number of workers in flight. Settled
// per item: one unreadable manifest must not empty the listing.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      try { results[index] = await worker(items[index]); }
      catch { results[index] = null; }
    }
  });
  await Promise.all(runners);
  return results;
}

function readCache(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    if (!Array.isArray(parsed.models) || !parsed.manifests || typeof parsed.manifests !== "object") return null;
    return parsed;
  } catch { return null; }
}

function writeCache(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.part`;
    fs.writeFileSync(temporary, JSON.stringify(payload));
    fs.renameSync(temporary, file);
  } catch { /* a cold cache costs a request, not the feature */ }
}

function createHubClient({
  cacheFile,
  fetchImpl = fetch,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  concurrency = DEFAULT_CONCURRENCY,
  limit = 200,
} = {}) {
  let memory = cacheFile ? readCache(cacheFile) : null;

  function persist() {
    if (cacheFile && memory) writeCache(cacheFile, memory);
  }

  async function fetchManifest(repo, sha, signal) {
    const response = await fetchImpl(manifestUrl(repo, sha), {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(MANIFEST_TIMEOUT_MS)]) : AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    // A repository may legitimately have no manifest; that is data, not failure.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    const manifest = await readJson(response, MAX_MANIFEST_BYTES);
    return manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : null;
  }

  // Returns { models, manifests, fetchedAt, stale }. `stale` marks a result
  // served from cache because the network could not be reached, so the UI can
  // say so instead of presenting an old listing as current.
  async function load({ signal, force = false } = {}) {
    const fresh = memory && !force && now() - memory.fetchedAt < ttlMs;
    if (fresh) return { ...memory, stale: false };

    let models;
    try {
      const response = await fetchImpl(listUrl(limit), {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(LIST_TIMEOUT_MS)]) : AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`listing HTTP ${response.status}`);
      const payload = await readJson(response, MAX_LIST_BYTES);
      if (!Array.isArray(payload)) throw new Error("Unexpected listing payload");
      models = payload;
    } catch (error) {
      if (memory) return { ...memory, stale: true, error: error.message };
      throw error;
    }

    // Manifests are immutable at a revision, so a cached one is reused whenever
    // the repository still points at the same commit.
    const cached = (memory && memory.manifests) || {};
    const wanted = models.filter((model) =>
      model && typeof model.id === "string" && typeof model.sha === "string"
      && Array.isArray(model.siblings)
      && model.siblings.some((sibling) => sibling && sibling.rfilename === "manifest.json"));
    const missing = wanted.filter((model) => !(`${model.id}@${model.sha}` in cached));
    const fetched = await mapLimit(missing, concurrency, async (model) => ({
      key: `${model.id}@${model.sha}`,
      manifest: await fetchManifest(model.id, model.sha, signal),
    }));

    const manifests = {};
    for (const model of wanted) {
      const key = `${model.id}@${model.sha}`;
      if (key in cached) manifests[key] = cached[key];
    }
    for (const result of fetched) if (result) manifests[result.key] = result.manifest;

    memory = { version: CACHE_VERSION, fetchedAt: now(), models, manifests };
    persist();
    return { ...memory, stale: false };
  }

  return {
    load,
    manifestFor: (repo, sha) => (memory && memory.manifests ? memory.manifests[`${repo}@${sha}`] : undefined),
    cachedAt: () => (memory ? memory.fetchedAt : null),
    clear() { memory = null; if (cacheFile) try { fs.rmSync(cacheFile, { force: true }); } catch { /* nothing to clear */ } },
  };
}

module.exports = {
  HUB, TAG, CACHE_VERSION, DEFAULT_TTL_MS,
  MAX_LIST_BYTES, MAX_MANIFEST_BYTES,
  listUrl, manifestUrl, mapLimit, createHubClient,
};
