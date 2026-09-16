"use strict";
// Turns the Hub listing into the ordered catalogue the market window renders.
const os = require("node:os");
const path = require("node:path");
const { createHubClient } = require("./hub-client.js");
const { normalizeEntry, STATUS } = require("./manifest.js");
const { mediaUrl } = require("./media-protocol.js");

// Ready entries first: they are the ones a click can actually use. Within a
// band, the Hub's own signals order them, with the newest breaking ties.
const BANDS = [STATUS.ready, STATUS.manual, STATUS.unverifiable, STATUS.incompatible];

function defaultCacheFile(homeDir = os.homedir()) {
  return path.join(homeDir, ".duck-on-desk", "market", "hub-cache.json");
}

function rank(entry) {
  const band = BANDS.indexOf(entry.status);
  return band === -1 ? BANDS.length : band;
}

function compare(a, b) {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (b.likes !== a.likes) return b.likes - a.likes;
  if (b.downloads !== a.downloads) return b.downloads - a.downloads;
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
}

function withMedia(entry) {
  const proxied = (file) => (file && entry.sha ? mediaUrl(entry.owner, entry.slug, entry.sha, file) : null);
  return { ...entry, mediaUrl: proxied(entry.mediaPath), posterUrl: proxied(entry.posterPath) };
}

function createMarketCatalog({ cacheFile = defaultCacheFile(), fetchImpl, ttlMs, now } = {}) {
  const hub = createHubClient({ cacheFile, fetchImpl, ttlMs, now });

  async function list({ force = false, signal } = {}) {
    const loaded = await hub.load({ force, signal });
    const entries = loaded.models
      .map((model) => normalizeEntry(model, loaded.manifests[`${model && model.id}@${model && model.sha}`] || null))
      .filter(Boolean)
      .map(withMedia)
      .sort(compare);
    const counts = {};
    for (const entry of entries) counts[entry.status] = (counts[entry.status] || 0) + 1;
    return { entries, counts, fetchedAt: loaded.fetchedAt, stale: Boolean(loaded.stale), error: loaded.error || null };
  }

  return { list, clear: hub.clear };
}

module.exports = { createMarketCatalog, defaultCacheFile, compare, BANDS };
