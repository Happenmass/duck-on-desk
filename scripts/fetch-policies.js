#!/usr/bin/env node
"use strict";
// Fills the global Hugging Face cache with every policy the duck runs — the
// official Microduck simulator policies and the community stilt policies, both
// pinned. Weights stay in the user cache and are never staged in the app.
const fs = require("node:fs");
const path = require("node:path");
const {
  POLICY_COMMIT, POLICY_NAMES, STILTS_COMMIT, STILT_HEIGHTS_CM, policyDirectory, stiltsDirectory,
} = require("../src/robots/duck/pet-model-protocol");

const SPACE_URL = `https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/${POLICY_COMMIT}/app/public/policies/`;
const STILTS_URL = `https://huggingface.co/HannesVonEssen/microduck-stilts/resolve/${STILTS_COMMIT}/`;
const MIN_BYTES = 100_000; // every policy is ~0.8 MB; anything smaller is an error page

function plan({ homeDir } = {}) {
  const official = [...POLICY_NAMES].map((name) => ({
    rel: name, url: SPACE_URL + name, cache: path.join(policyDirectory(homeDir), name),
  }));
  const stilts = [...STILT_HEIGHTS_CM].map((h) => ({
    rel: path.join("stilts", `${h}cm`, "policy.onnx"),
    url: `${STILTS_URL}${h}cm/policy.onnx`,
    cache: path.join(stiltsDirectory(homeDir), `${h}cm`, "policy.onnx"),
  }));
  return [...official, ...stilts];
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < MIN_BYTES) throw new Error(`suspiciously small download (${bytes.length} bytes) for ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, bytes);
  fs.renameSync(`${file}.part`, file);
  return bytes.length;
}

async function main() {
  let downloaded = 0, cached = 0;
  for (const item of plan()) {
    if (fs.existsSync(item.cache) && fs.statSync(item.cache).size >= MIN_BYTES) {
      cached++;
    } else {
      const size = await download(item.url, item.cache);
      downloaded++;
      console.log(`downloaded ${item.rel} (${(size / 1024).toFixed(0)} KB)`);
    }

  }
  console.log(`Policies ready: ${cached} from cache, ${downloaded} downloaded in the global cache`);
}

module.exports = { plan };
if (require.main === module) main().catch((err) => { console.error(err.message || err); process.exit(1); });
