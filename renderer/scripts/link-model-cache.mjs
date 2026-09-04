import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commit = "183f99a40bd7308da3e848de961ed32bb02624a5";
const required = [
  "BEST_alpha_walking.onnx",
  "BEST_alpha_sitstand.onnx",
  "BEST_alpha_stand.onnx",
  "alpha_ground_pick.onnx",
];
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(os.homedir(), ".cache", "huggingface", "microduck-simulator", commit, "policies");
const link = path.join(projectRoot, "models", "policies");

for (const name of required) {
  if (!fs.existsSync(path.join(cache, name))) {
    throw new Error(`missing required policy in global cache: ${path.join(cache, name)}`);
  }
}

fs.mkdirSync(path.dirname(link), { recursive: true });
let stat = null;
try {
  stat = fs.lstatSync(link);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (stat) {
  if (!stat.isSymbolicLink()) throw new Error(`refusing to replace non-symlink path: ${link}`);
  const current = path.resolve(path.dirname(link), fs.readlinkSync(link));
  if (current !== cache) throw new Error(`model link targets ${current}, expected ${cache}`);
} else {
  fs.symlinkSync(cache, link, "dir");
}

console.log(`Model cache ready: ${link} -> ${cache}`);
