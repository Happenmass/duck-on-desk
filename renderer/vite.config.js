import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const POLICY_DIR = path.resolve(here, "models/policies");

// Dev-only: serve ONNX policies from the global cache symlink. The packaged app uses pet-model:// instead.
function localPolicyPlugin() {
  const jobs = process.env.DUCK_LAB_DEV === "1" ? require("../mcp/robot-lab/jobs.cjs").createLabJobs() : null;
  return {
    name: "local-policy-cache",
    configureServer(server) {
      if (jobs) {
        server.middlewares.use("/__lab/request", async (req, res) => {
          res.setHeader("Content-Type", "application/json");
          if (req.method !== "POST" || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) { res.statusCode = 403; res.end('{}'); return; }
          try {
            let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 150000) throw new Error("Request too large"); }
            const {action,payload={}} = JSON.parse(body); let result;
            switch(action) {
              case "bootstrap": result={defaults:jobs.defaults(),jobs:jobs.list(),active:jobs.activation()};break;
              case "action-defaults": result=payload.task==='microduck-flat-walk'?jobs.defaults():payload.task==='microduck-headstand-hold'?jobs.holdDefaults():payload.task==='microduck-headstand'?jobs.headstandDefaults():jobs.actionDefaults();break;
              case "actions": result=jobs.actions();break;
              case "add-action": result=jobs.addAction(payload.id,payload.name,payload.evaluation);break;
              case "remove-action": result=jobs.removeAction(payload.id);break;
              case "start": result=jobs.start(payload);break;
              case "resume": result=jobs.resume(payload.id,payload);break;
              case "list": result=jobs.list();break;
              case "get": result=jobs.get(payload.id);break;
              case "cancel": result=jobs.cancel(payload.id);break;
              case "live-preview": result=jobs.preview(payload.id,payload.enabled);break;
              case "policy": case "export": jobs.artifact(payload.id);result={url:`/policies/${encodeURIComponent(`lab/${payload.id}/policy.onnx`)}`};break;
              case "apply": result=jobs.apply(payload.id,payload.evaluation);break;
              case "rollback": result=jobs.rollback();break;
              default: throw new Error("Unknown lab action");
            }
            res.end(JSON.stringify(result));
          } catch(error) { res.end(JSON.stringify({error:error.message})); }
        });
        server.httpServer?.once("close", () => jobs.dispose());
      }
      server.middlewares.use("/policies", (req, res, next) => {
        let name;
        try { name = decodeURIComponent(path.basename(new URL(req.url, "http://local").pathname)); }
        catch { res.statusCode=400; return res.end("Invalid policy URL"); }
        const lab = /^lab\/(run_[a-f0-9-]{36})\/policy\.onnx$/.exec(name);
        if (lab && jobs) {
          try { res.setHeader("Content-Type", "application/octet-stream"); return fs.createReadStream(jobs.artifact(lab[1])).pipe(res); }
          catch { res.statusCode=404;return res.end("policy not available"); }
        }
        if (!/^[A-Za-z0-9_.-]+\.onnx$/.test(name)) return next();
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
  build: { rollupOptions: { input: { pet: path.join(here, "index.html"), lab: path.join(here, "lab.html") } }, outDir: path.resolve(here, "../renderer-dist"), emptyOutDir: true, assetsDir: "bundle", chunkSizeWarningLimit: 1500 },
});
