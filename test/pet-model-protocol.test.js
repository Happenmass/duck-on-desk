const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { POLICY_NAMES, resolvePolicyRequest, policyDirectory } = require("../src/robots/duck/pet-model-protocol");

test("policy directory points at the pinned simulator commit in the HF cache", () => {
  const dir = policyDirectory("/home/u");
  assert.equal(dir, path.join("/home/u", ".cache", "huggingface", "microduck-simulator",
    "183f99a40bd7308da3e848de961ed32bb02624a5", "policies"));
});

test("only whitelisted policy names resolve", () => {
  assert.deepEqual([...POLICY_NAMES].sort(), ["BEST_alpha_sitstand.onnx", "BEST_alpha_stand.onnx", "BEST_alpha_walking.onnx", "BEST_roller.onnx", "BEST_roller_crouch.onnx", "alpha_ground_pick.onnx"]);
  const ok = resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => true });
  assert.equal(ok.status, 200);
  assert.ok(ok.file.endsWith(path.join("policies", "BEST_alpha_walking.onnx")));
  assert.equal(resolvePolicyRequest("pet-model://policy/evil.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/..%2F..%2Fx.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => false }).status, 404);
});

test("stilt policies resolve to the pinned Hub snapshot in the HF cache", () => {
  const { resolvePolicyRequest, STILTS_COMMIT } = require("../src/robots/duck/pet-model-protocol");
  const ok = resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: () => true });
  assert.equal(ok.status, 200);
  assert.equal(ok.file, path.join("/home/u", ".cache", "huggingface", "hub", "models--HannesVonEssen--microduck-stilts", "snapshots", STILTS_COMMIT, "25cm", "policy.onnx"));
  assert.equal(resolvePolicyRequest("pet-model://policy/stilts%2F30cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fcheckpoint.pt", { homeDir: "/home/u", exists: () => true }).status, 404);
  assert.equal(resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: () => false }).status, 404);
});

test("the official roller policies resolve from the simulator cache", () => {
  const { resolvePolicyRequest, POLICY_COMMIT } = require("../src/robots/duck/pet-model-protocol");
  for (const name of ["BEST_roller.onnx", "BEST_roller_crouch.onnx"]) {
    const ok = resolvePolicyRequest(`pet-model://policy/${name}`, { homeDir: "/home/u", exists: () => true });
    assert.equal(ok.status, 200);
    assert.equal(ok.file, path.join("/home/u", ".cache", "huggingface", "microduck-simulator", POLICY_COMMIT, "policies", name));
  }
});

test("policies fall back to the app bundle when the cache lacks them", () => {
  const { resolvePolicyRequest, STILTS_COMMIT } = require("../src/robots/duck/pet-model-protocol");
  const bundledDir = path.join("/app", "resources", "policies");
  const onlyBundled = (file) => file.startsWith(bundledDir);
  const walk = resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: onlyBundled, bundledDir });
  assert.equal(walk.status, 200);
  assert.equal(walk.file, path.join(bundledDir, "BEST_alpha_walking.onnx"));
  const stilt = resolvePolicyRequest("pet-model://policy/stilts%2F25cm%2Fpolicy.onnx", { homeDir: "/home/u", exists: onlyBundled, bundledDir });
  assert.equal(stilt.file, path.join(bundledDir, "stilts", "25cm", "policy.onnx"));
  // the cache still wins when it has the file
  const cached = resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => true, bundledDir });
  assert.equal(cached.file, path.join("/home/u", ".cache", "huggingface", "microduck-simulator", "183f99a40bd7308da3e848de961ed32bb02624a5", "policies", "BEST_alpha_walking.onnx"));
  assert.ok(STILTS_COMMIT);
  assert.equal(resolvePolicyRequest("pet-model://policy/BEST_alpha_walking.onnx", { homeDir: "/home/u", exists: () => false, bundledDir }).status, 404);
});

test('missing pinned models download once into the user cache; failures and unknown names do not poison it', async t => {
  const fs=require('node:fs'),os=require('node:os');
  const {ensureCachedPolicy}=require('../src/robots/duck/pet-model-protocol');
  const homeDir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-model-cache-'));
  t.after(()=>fs.rmSync(homeDir,{recursive:true,force:true}));
  let calls=0;
  const bytes=Buffer.alloc(100001,7);
  const fetchImpl=async url=>{calls++;assert.match(url,/huggingface\.co\/spaces\/pollen-robotics\/microduck-simulator\/resolve\/183f99/);return {ok:true,arrayBuffer:async()=>bytes};};
  const url='pet-model://policy/BEST_alpha_walking.onnx';
  await Promise.all([ensureCachedPolicy(url,{homeDir,fetchImpl}),ensureCachedPolicy(url,{homeDir,fetchImpl})]);
  await ensureCachedPolicy(url,{homeDir,fetchImpl});
  assert.equal(calls,1);assert.deepEqual(fs.readFileSync(path.join(policyDirectory(homeDir),'BEST_alpha_walking.onnx')),bytes);
  await ensureCachedPolicy('pet-model://policy/unknown.onnx',{homeDir,fetchImpl});assert.equal(calls,1);
  const bad='pet-model://policy/BEST_alpha_stand.onnx';
  await assert.rejects(ensureCachedPolicy(bad,{homeDir,fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
  assert.equal(resolvePolicyRequest(bad,{homeDir}).status,404);
  await ensureCachedPolicy(bad,{homeDir,fetchImpl});assert.equal(resolvePolicyRequest(bad,{homeDir}).status,200);
});

test('packaged protocol resolves shared cache beside app.asar without relying on host Electron resourcesPath',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-packaged-policy-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const directory=path.join(tmp,'resources/app.asar/src/robots/duck');fs.mkdirSync(directory,{recursive:true});
 const cache=path.join(tmp,'resources/robot-lab-mcp/policy-cache.cjs');fs.mkdirSync(path.dirname(cache));fs.writeFileSync(cache,'module.exports={SCHEME:"pet-model",fixture:true};');
 const source=fs.readFileSync(path.join(__dirname,'../src/robots/duck/pet-model-protocol.js'),'utf8');
 const sandbox={__dirname:directory,require,module:{exports:{}}};vm.runInNewContext(source,sandbox);
 assert.equal(sandbox.module.exports.fixture,true);
});
