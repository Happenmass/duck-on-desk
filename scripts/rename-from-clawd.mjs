#!/usr/bin/env node
// One-shot identity rename: duck-on-desk -> duck-on-desk. Run once after the subtraction tasks.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const TEXT_DIRS = ["src", "hooks", "agents", "test", "scripts", "extensions", "themes", "docs", ".github", "build"];
const TEXT_FILES = ["package.json", "package-lock.json", "README.md", "README.zh-CN.md", "AGENTS.md", "CLAUDE.md", "launch.js", "test-macos.sh", ".gitignore"];
const TEXT_EXT = new Set([".js", ".cjs", ".mjs", ".ts", ".json", ".md", ".html", ".css", ".yml", ".yaml", ".sh", ".ps1", ".nsh", ".txt", ".svg"]);

// Order matters: specific tokens before the generic word.
const SUBS = [
  [/duck-on-desk/g, "duck-on-desk"],
  [/Duck on Desk/g, "Duck on Desk"],
  [/Duck-on-Desk/g, "Duck-on-Desk"],
  [/com\.duck-on-desk\.on-desk/g, "com.guhappen.duck-on-desk"],
  [/\.duck(?=[\/\\"'`\)\]-]|$)/gm, ".duck-on-desk"],
  [/DUCK_/g, "DUCK_"],
  [/x-duck-/g, "x-duck-"],
  [/X-Duck-/g, "X-Duck-"],
  [/duck:\/\//g, "duck://"],
  [/duck/g, "duck"],
  [/Duck/g, "Duck"],
  [/DUCK/g, "DUCK"],
  [/\b2333([3-8])\b/g, (_, d) => `2433${d}`],
  [/\b2345([6-9])\b/g, (_, d) => `2445${d}`],
  [/\b23460\b/g, "24460"],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "renderer-dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

let changed = 0;
const files = TEXT_FILES.map((f) => join(ROOT, f)).filter(existsSync);
for (const d of TEXT_DIRS) if (existsSync(join(ROOT, d))) for (const f of walk(join(ROOT, d))) files.push(f);
for (const f of files) {
  const ext = f.slice(f.lastIndexOf("."));
  if (!TEXT_EXT.has(ext)) continue;
  const before = readFileSync(f, "utf8");
  let after = before;
  for (const [re, to] of SUBS) after = after.replace(re, to);
  if (after !== before) { writeFileSync(f, after); changed++; }
}
console.log(`text files changed: ${changed}`);

// Path renames via git mv (deepest first so directory renames come last).
let renamed = 0;
const paths = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
  .filter((p) => /duck/i.test(basename(p)))
  .sort((a, b) => b.length - a.length);
for (const p of paths) {
  if (!existsSync(p)) continue;
  const target = join(dirname(p), basename(p).replace(/duck/g, "duck").replace(/Duck/g, "Duck"));
  if (target !== p) { execSync(`git mv "${p}" "${target}"`); renamed++; }
}
if (existsSync("themes/duck")) { execSync("git mv themes/duck themes/duck"); renamed++; }
console.log(`paths renamed: ${renamed}`);
