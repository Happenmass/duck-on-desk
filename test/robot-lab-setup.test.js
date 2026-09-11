'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTrainingSetup,UV_VERSION,MJLAB_COMMIT}=require('../mcp/robot-lab/setup.cjs');
const {policyDirectory}=require('../src/robots/duck/policy-cache');
function fixture(t,{cached=true,...options}={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'duck-setup-test-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const asset_dir=path.join(home,'robot');fs.mkdirSync(asset_dir);fs.writeFileSync(path.join(asset_dir,'robot_allcollisions.xml'),'<fixture/>');
 const base_policy=path.join(policyDirectory(home),'BEST_alpha_walking.onnx');
 if(cached){fs.mkdirSync(path.dirname(base_policy),{recursive:true});fs.writeFileSync(base_policy,'synthetic fixture');}
 const calls=[];let failInstall=false;
 const runCommand=async(file,args,{env}={})=>{
  calls.push({file,args,env});
  if(failInstall&&args[0]==='sync')throw Error('fixture network error');
  if(args[0]==='sync'){const p=path.join(env.UV_PROJECT_ENVIRONMENT,'Scripts/python.exe');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'fixture interpreter');}
  return args.includes('-c')?JSON.stringify({python:file,torch:'2.9.1+cu128',devices:JSON.parse(args.at(-1))}):'';
 };
 const setup=createTrainingSetup({home,platform:'win32',arch:'x64',runCommand,...options});
 const binary=path.join(home,'.duck-on-desk','training-runtime','tools',`uv-${UV_VERSION}`,'uv.exe');
 fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'fixture uv');
 return {home,setup,calls,binary,failInstall:v=>{failInstall=v;},config:{asset_dir,base_policy,pythonPath:'',training_device:'cuda',inference_device:'cuda'}};
}
test('Windows managed install clones the pinned official repo, syncs its lock, swaps in CUDA torch and verifies actual computation before readiness',async t=>{
 const {setup,calls,config}=fixture(t);const messages=[];const result=await setup.prepare(config,m=>messages.push(m));
 assert.match(result.pythonPath,/py312-mjlab-cuda[/\\]Scripts[/\\]python.exe$/);
 assert.ok(calls.some(c=>c.file==='git'&&c.args[0]==='clone'&&c.args.includes('https://github.com/pollen-robotics/microduck_rl.git')));
 assert.ok(calls.some(c=>c.file==='git'&&c.args.includes('checkout')&&c.args.includes(MJLAB_COMMIT)));
 const sync=calls.find(c=>c.args[0]==='sync');assert.ok(sync.args.includes('--frozen'));assert.match(sync.env.UV_PROJECT_ENVIRONMENT,/py312-mjlab-cuda$/);
 const cuda=calls.find(c=>c.args.includes('https://download.pytorch.org/whl/cu128'));assert.ok(cuda.args.includes('torch==2.9.1+cu128')&&cuda.args.includes('--reinstall-package'),'Windows PyPI torch is CPU-only');
 assert.ok(calls.at(-1).args[2].includes('x*x'));
 const n=calls.length;await setup.prepare(config);assert.equal(calls.length,n+1,'ready environments are probed, not reinstalled');
 assert.equal(messages.at(-1),'训练环境与模型已就绪');
});
test('cold cache downloads pinned base policy before installing; download failure is retryable',async t=>{
 let failing=true;const urls=[];
 const {setup,config}=fixture(t,{cached:false,fetchImpl:async url=>{urls.push(url);return {ok:!failing,status:503,arrayBuffer:async()=>Buffer.alloc(100001)};}});
 await assert.rejects(setup.prepare(config),/HTTP 503/);assert.equal(fs.existsSync(config.base_policy),false);
 failing=false;await setup.prepare(config);assert.equal(fs.statSync(config.base_policy).size,100001);
 assert.equal(urls.length,2);assert.match(urls[0],/183f99a40bd7308da3e848de961ed32bb02624a5/);
});
test('failed dependency install releases lock, leaves no ready marker and can resume installation',async t=>{
 const {setup,config,failInstall,home}=fixture(t);failInstall(true);
 await assert.rejects(setup.prepare(config),/network error/);
 assert.equal(fs.existsSync(path.join(home,'.duck-on-desk/training-runtime/setup.lock')),false);
 const marker=path.join(path.dirname(path.dirname(setup.managedPython('cuda'))),'ready.json');assert.equal(fs.existsSync(marker),false);
 failInstall(false);await setup.prepare(config);assert.ok(fs.existsSync(marker));
});
test('an explicit custom interpreter is only checked; never pip-installed or silently replaced',async t=>{
 const {setup,config,calls}=fixture(t);await setup.prepare({...config,pythonPath:'C:\\My Python\\python.exe'});
 assert.equal(calls.length,1);assert.equal(calls[0].file,'C:\\My Python\\python.exe');
 const other=fixture(t,{runCommand:async()=>{throw Error('CUDA unavailable');}});
 await assert.rejects(other.setup.prepare({...other.config,pythonPath:'custom-python'}),/自定义 Python.*CUDA unavailable/);
});
test('unsupported backend and missing packaged XML produce distinct actionable errors',async t=>{
 const {setup,config,calls}=fixture(t);
 await assert.rejects(setup.prepare({...config,training_device:'mps'}),/MPS 仅适用于/);
 fs.rmSync(path.join(config.asset_dir,'robot_allcollisions.xml'));
 await assert.rejects(setup.prepare(config),/安装包缺少机器人仿真资源/);assert.equal(calls.length,0);
});
test('corrupt environment tool downloads are rejected before extracting or executing',async t=>{
 const {setup,config,binary,calls}=fixture(t,{fetchImpl:async()=>({ok:true,arrayBuffer:async()=>Buffer.from('corrupt archive')})});
 fs.rmSync(binary);await assert.rejects(setup.prepare(config),/校验失败/);assert.equal(calls.length,0);
});
test('cancelled preparation does not start installation',async t=>{
 const {setup,config,calls}=fixture(t);const controller=new AbortController();controller.abort();
 await assert.rejects(setup.prepare(config,()=>{},controller.signal),{name:'AbortError'});assert.equal(calls.length,0);
});
