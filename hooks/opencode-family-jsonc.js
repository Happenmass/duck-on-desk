// JSONC editor for opencode-family members whose host config is JSONC
// (registry entries with jsonc: true — today only mimocode).
//
// The JSON path in opencode-family-install.js round-trips through
// JSON.parse/JSON.stringify, which would DESTROY user comments and trailing
// commas in a JSONC file. This module performs element-level edits with
// jsonc-parser (modify/applyEdits) so everything the user wrote survives;
// only the "plugin" array entry we manage is touched (plan §4.1).
//
// MERGED-CONFIG SEMANTICS (verified against MiMo Code v0.1.6 —
// config.ts:588-590, paths.ts:63-65, plugin/install.ts:349-355): the host
// merges EVERY file in cfg.configCandidates (lowest priority first at load,
// so the list here is highest-priority first), and array fields like
// "plugin" are REPLACED by the later file, not concatenated. Consequences
// (#607 review):
//   - register must edit the file whose "plugin" actually wins — writing a
//     fresh plugin array into a higher-priority file would silently mask
//     every plugin the user declared in a lower one;
//   - unregister must sweep ALL candidates, or a managed entry masked today
//     could resurrect when the user deletes the higher-priority file.
//
// Deliberately a SEPARATE module, lazy-required by the shared installer only
// when cfg.jsonc is set: hooks/json-utils.js is deployed to remote SSH hosts
// without node_modules and must stay dependency-free, so jsonc-parser must
// never be required from it (locked by a remote-closure guard test).
//
// Contract parity: registerJsonc/unregisterJsonc return the same shapes and
// print the same console lines as the JSON branch in makeFamilyInstaller —
// callers cannot tell the two apart. `configPath` in the return names the
// file actually edited.

const fs = require("fs");
const path = require("path");
const { parse, parseTree, findNodeAtLocation, modify, applyEdits } = require("jsonc-parser");
const {
  readTextFileStripBom,
  writeTextAtomic,
  writeTextAtomicWithBackup,
} = require("./json-utils");

// Default 2-space style for inserted elements (fresh files, space-indented
// configs).
const FORMATTING = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

// Match the TARGET file's own indentation: hardcoding spaces would leave a
// tab-indented user config with mixed indentation (dual-review S-F4).
function formattingFor(text) {
  return /\n\t/.test(text)
    ? { formattingOptions: { insertSpaces: false, tabSize: 1 } }
    : FORMATTING;
}

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };

function normalizePluginEntry(value) {
  return String(value || "").replace(/\\/g, "/");
}

function entryIsExactManagedPlugin(entry, pluginDir) {
  return typeof entry === "string" && normalizePluginEntry(entry) === normalizePluginEntry(pluginDir);
}

// Ownership rule shared by register AND unregister: Clawd owns the exact
// managed path plus any ABSOLUTE entry whose directory basename matches the
// plugin dir (a stale install at another location). Register updates such
// entries in place; unregister must remove them too — an asymmetric sweep
// would leave a masked stale path in a lower-priority file to resurrect
// once the higher-priority file goes away (#607 review R8). npm package
// specifiers (never absolute) stay untouched.
function isManagedEntry(entry, pluginDir, pluginDirName) {
  if (typeof entry !== "string") return false;
  if (entryIsExactManagedPlugin(entry, pluginDir)) return true;
  const normalized = entry.replace(/\\/g, "/");
  const isAbsolute = path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized);
  return isAbsolute && path.posix.basename(normalized) === pluginDirName;
}

// Preserve the target's permission bits across the rename-into-place write:
// a 0600 config holding provider tokens must not come back 0644 (R8 P1).
function fileMode(filePath) {
  try {
    return fs.statSync(filePath).mode & 0o777;
  } catch {
    return undefined;
  }
}

function parseJsoncStrict(text, configPath) {
  const errors = [];
  const tree = parse(text, errors, PARSE_OPTIONS);
  if (errors.length) {
    // Do not clobber a config we cannot fully understand — same stance as the
    // JSON branch on a JSON.parse failure.
    throw new Error(`Failed to read ${configPath}: invalid JSONC (${errors.length} parse error${errors.length === 1 ? "" : "s"})`);
  }
  return tree;
}

function freshConfigText(cfg, pluginDir) {
  const settings = cfg.schema ? { $schema: cfg.schema, plugin: [pluginDir] } : { plugin: [pluginDir] };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

// Candidate files in HIGHEST-priority-first order. configPath is the
// create-default (join(configDir, cfg.configFileName)); its directory hosts
// the sibling candidates. A test override with a custom basename is
// prepended so single-file fixtures keep working.
function candidatePaths(cfg, configPath) {
  const dir = path.dirname(configPath);
  const names = Array.isArray(cfg.configCandidates) && cfg.configCandidates.length
    ? cfg.configCandidates
    : [cfg.configFileName];
  const paths = names.map((name) => path.join(dir, name));
  if (!paths.includes(configPath)) paths.unshift(configPath);
  return paths;
}

// A duplicate top-level "plugin" key makes the file AMBIGUOUS to edit:
// parse() resolves to the LAST value (what the host runs), but
// modify()/findNodeAtLocation() target the FIRST property node — an edit
// would change a dead array while reporting success, and a sweep would
// count matches in one array and delete from another (R10/GPT-5.5 P2,
// reproduced). Same do-not-clobber stance as a parse failure: refuse.
function assertSinglePluginProperty(text, configPath) {
  const root = parseTree(text, [], PARSE_OPTIONS);
  if (!root || root.type !== "object" || !Array.isArray(root.children)) return;
  let count = 0;
  for (const prop of root.children) {
    const keyNode = Array.isArray(prop.children) ? prop.children[0] : null;
    if (keyNode && keyNode.value === "plugin") count++;
  }
  if (count > 1) {
    throw new Error(`Failed to read ${configPath}: duplicate top-level "plugin" keys (${count}) — refusing to edit an ambiguous config`);
  }
}

// Read every candidate: { path, exists, text, tree }. Throws on a candidate
// that exists but cannot be parsed or carries duplicate "plugin" keys —
// editing around a file we cannot fully understand risks masking or
// clobbering user content.
function readCandidates(cfg, configPath) {
  return candidatePaths(cfg, configPath).map((candidate) => {
    let text = null;
    try {
      text = readTextFileStripBom(candidate, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") return { path: candidate, exists: false, text: null, tree: null };
      throw new Error(`Failed to read ${candidate}: ${err.message}`);
    }
    const tree = parseJsoncStrict(text, candidate);
    assertSinglePluginProperty(text, candidate);
    return { path: candidate, exists: true, text, tree };
  });
}

function isObjectRoot(tree) {
  return !!tree && typeof tree === "object" && !Array.isArray(tree);
}

function declaresPlugin(state) {
  return state.exists && isObjectRoot(state.tree) && Object.prototype.hasOwnProperty.call(state.tree, "plugin");
}

// Same idempotency rule as the JSON branch: match by exact path OR by
// directory basename on an ABSOLUTE-path entry (stale installs at another
// location get updated in place; npm package specifiers — which can also
// live in the plugin array — are never touched because they aren't absolute).
function findManagedIndex(pluginArray, pluginDir, pluginDirName) {
  for (let i = 0; i < pluginArray.length; i++) {
    if (isManagedEntry(pluginArray[i], pluginDir, pluginDirName)) return i;
  }
  return -1;
}

// Position of the next non-trivia character at/after `pos`: skips whitespace
// (incl. newlines) and both comment forms. Used to find an element's
// separating comma even when a comment sits between them — scanning only
// horizontal whitespace would stop at the comment and leave a dangling comma
// behind (dual-review F1).
function skipTriviaForward(text, pos) {
  let cursor = pos;
  for (;;) {
    while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) cursor++;
    if (text[cursor] === "/" && text[cursor + 1] === "/") {
      while (cursor < text.length && text[cursor] !== "\n") cursor++;
      continue;
    }
    if (text[cursor] === "/" && text[cursor + 1] === "*") {
      const close = text.indexOf("*/", cursor + 2);
      if (close === -1) return cursor;
      cursor = close + 2;
      continue;
    }
    return cursor;
  }
}

// Element removal is done with CUSTOM span surgery instead of jsonc-parser's
// modify(): upstream 3.3.1 emits a corrupt edit (dangling quote) when
// removing from a single-line array, and on multi-line arrays its removal
// span swallows trivia — i.e. USER COMMENTS — adjacent to the removed
// element (both probed). We compute each element's exact span from the
// parse tree and remove only the element token plus ONE adjacent comma, so
// comments before, after, and on neighboring lines always survive. A line
// left fully blank by the removal is consumed for tidiness.
function removeEntriesFromText(text, matches) {
  const root = parseTree(text, [], PARSE_OPTIONS);
  const arr = root ? findNodeAtLocation(root, ["plugin"]) : null;
  if (!arr || !Array.isArray(arr.children)) return text;

  const spans = matches.map((index) => {
    const node = arr.children[index];
    let start = node.offset;
    let end = node.offset + node.length;

    // Prefer eating the FOLLOWING comma — the next non-trivia token after
    // the element. Trivia between the element and its comma (e.g. an inline
    // /* note */) annotates the REMOVED element and goes with it; leaving it
    // would strand a dangling comma and corrupt the file. For a last
    // element, eat the PRECEDING comma instead.
    const cursor = skipTriviaForward(text, end);
    if (text[cursor] === ",") {
      end = cursor + 1;
    } else {
      let back = start - 1;
      while (back >= 0 && /[ \t\r\n]/.test(text[back])) back--;
      if (text[back] === ",") start = back;
    }

    // Consume the whole line when nothing but whitespace remains on it.
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
    let lineEnd = end;
    while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd++;
    // \r counts as blank so CRLF files don't keep a whitespace-only line
    // after a mid-array removal (dual-review F2).
    if (/^[ \t]*$/.test(text.slice(lineStart, start)) && /^[ \t\r]*$/.test(text.slice(end, lineEnd))) {
      start = lineStart;
      end = Math.min(lineEnd + 1, text.length);
    }
    return { start, end };
  });

  // Adjacent removed elements can claim the SAME comma (one eats forward,
  // the next eats backward) — merge overlapping spans into their union
  // before applying, or the later slice would use stale offsets.
  spans.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  // Apply back-to-front so earlier spans stay valid.
  let out = text;
  for (let k = merged.length - 1; k >= 0; k--) {
    out = out.slice(0, merged[k].start) + out.slice(merged[k].end);
  }
  return out;
}

function registerJsonc({ cfg, agentId, configPath, pluginDir, options = {} }) {
  const states = readCandidates(cfg, configPath);

  // Write target: the file whose "plugin" is effectively live (highest
  // priority declaring it) → else the highest-priority existing file →
  // else create the default file fresh.
  const target = states.find(declaresPlugin) || states.find((s) => s.exists) || null;

  let added = false;
  let skipped = false;
  let created = false;
  let editedPath = configPath;

  if (!target) {
    writeTextAtomic(configPath, freshConfigText(cfg, pluginDir));
    created = true;
    added = true;
  } else {
    editedPath = target.path;
    const mode = fileMode(target.path);
    let text = target.text;
    if (!isObjectRoot(target.tree)) {
      // Non-object root ("null", a bare number…). The JSON branch tolerates
      // this by starting over from {}; there are no meaningful comments to
      // preserve in a config with no object root, so we do the same.
      writeTextAtomic(target.path, freshConfigText(cfg, pluginDir), { mode });
      added = true;
    } else if (!Array.isArray(target.tree.plugin)) {
      // Missing or non-array "plugin" — (re)write just that property.
      text = applyEdits(text, modify(text, ["plugin"], [pluginDir], formattingFor(text)));
      writeTextAtomic(target.path, text, { mode });
      added = true;
    } else {
      const matchIndex = findManagedIndex(target.tree.plugin, pluginDir, cfg.pluginDirName);
      if (matchIndex === -1) {
        text = applyEdits(text, modify(text, ["plugin", -1], pluginDir, { ...formattingFor(text), isArrayInsertion: true }));
        writeTextAtomic(target.path, text, { mode });
        added = true;
      } else if (target.tree.plugin[matchIndex] !== pluginDir) {
        // Stale path (e.g. old install location) — update the element in place
        text = applyEdits(text, modify(text, ["plugin", matchIndex], pluginDir, formattingFor(text)));
        writeTextAtomic(target.path, text, { mode });
        added = true;
      } else {
        skipped = true;
      }
    }
  }

  if (!options.silent) {
    console.log(`Clawd ${agentId} plugin → ${editedPath}`);
    if (created) console.log(`  Created ${cfg.configFileName}`);
    if (added) console.log(`  Registered: ${pluginDir}`);
    if (skipped) console.log(`  Already registered: ${pluginDir}`);
  }

  return { added, skipped, created, configPath: editedPath, pluginDir };
}

function unregisterJsonc({ cfg, agentId, configPath, pluginDir, options = {} }) {
  const states = readCandidates(cfg, configPath);

  // Sweep EVERY candidate: an exact managed entry left in a lower-priority
  // file is masked today but becomes live the moment the higher-priority
  // file goes away.
  let removed = 0;
  const backupPaths = [];
  for (const state of states) {
    if (!state.exists || !isObjectRoot(state.tree) || !Array.isArray(state.tree.plugin)) continue;

    const matches = [];
    for (let i = 0; i < state.tree.plugin.length; i++) {
      if (isManagedEntry(state.tree.plugin[i], pluginDir, cfg.pluginDirName)) matches.push(i);
    }
    if (!matches.length) continue;

    const text = removeEntriesFromText(state.text, matches);
    const backupPath = writeTextAtomicWithBackup(state.path, text, { ...options, mode: fileMode(state.path) });
    if (backupPath) backupPaths.push(backupPath);
    removed += matches.length;
  }

  const changed = removed > 0;
  if (!options.silent) console.log(`Clawd ${agentId} plugin entries removed: ${removed}`);
  const result = { removed, changed, skipped: !changed, configPath, pluginDir };
  if (options.backup === true) {
    result.backupPath = backupPaths[0] || null;
    result.backupPaths = backupPaths;
  }
  return result;
}

module.exports = {
  registerJsonc,
  unregisterJsonc,
  __test: { parseJsoncStrict, findManagedIndex, entryIsExactManagedPlugin, isManagedEntry, freshConfigText, candidatePaths, removeEntriesFromText },
};
