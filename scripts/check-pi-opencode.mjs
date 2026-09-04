#!/usr/bin/env node
// Audits the Pi global extension directory and the opencode config plugin entry. Read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PI_FILES = ["index.ts", "pi-extension-core.js", ".duck-on-desk-managed.json"];

export function auditPiExtension(dir) {
  const missing = PI_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  return { ok: missing.length === 0, missing };
}

export function auditOpencodeConfig(config) {
  const plugins = Array.isArray(config && config.plugin) ? config.plugin : [];
  const ok = plugins.some((p) => typeof p === "string" && /opencode-plugin/.test(p));
  return { ok, plugins };
}

function readJsonc(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text);
}

// pathToFileURL, not `file://${argv[1]}`: a repo path with non-ASCII characters or
// spaces is percent-encoded in import.meta.url, so the raw string never matches.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const piDir = path.join(os.homedir(), ".pi", "agent", "extensions", "duck-on-desk");
  const pi = auditPiExtension(piDir);
  const ocDir = path.join(os.homedir(), ".config", "opencode");
  // Same candidate order as agents/opencode-family.js configCandidates: opencode
  // merges config.json → opencode.json → opencode.jsonc with later winning, so
  // the .jsonc is the file whose "plugin" array the host actually runs.
  const candidate = ["opencode.jsonc", "opencode.json", "config.json"].map((n) => path.join(ocDir, n)).find(fs.existsSync);
  const oc = candidate ? auditOpencodeConfig(readJsonc(candidate)) : { ok: false, plugins: [] };
  console.log(JSON.stringify({ pi, opencode: { file: candidate || null, ...oc } }, null, 2));
  process.exit(pi.ok && oc.ok ? 0 : 1);
}
