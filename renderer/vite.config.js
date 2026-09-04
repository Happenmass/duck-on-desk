import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const POLICY_DIR = path.resolve(here, "models/policies");

// Dev-only: serve ONNX policies from the global cache symlink. The packaged app uses pet-model:// instead.
function localPolicyPlugin() {
  return {
    name: "local-policy-cache",
    configureServer(server) {
      server.middlewares.use("/policies", (req, res, next) => {
        const name = path.basename(new URL(req.url, "http://local").pathname);
        if (!name.endsWith(".onnx")) return next();
        const file = path.join(POLICY_DIR, name);
        if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("policy not found in global cache"); }
        res.setHeader("Content-Type", "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: here,
  base: "./",
  plugins: [localPolicyPlugin()],
  server: { port: 5176, strictPort: true },
  build: { outDir: path.resolve(here, "../renderer-dist"), emptyOutDir: true, assetsDir: "bundle", chunkSizeWarningLimit: 1500 },
});
