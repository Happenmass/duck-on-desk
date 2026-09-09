'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLabJobs}=require('../mcp/robot-lab/jobs.cjs');
const {policyDirectory}=require('../src/robots/duck/pet-model-protocol');
function fixture(t,extra={}) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'duck-cold-regression-'));
 const assets=path.join(home,'resources/app.asar.unpacked/renderer-dist/robot/mjlab');
 fs.mkdirSync(assets,{recursive:true});fs.writeFileSync(path.join(assets,'robot_allcollisions.xml'),'<fixture/>');
 const jobs=createLabJobs({home,assetDir:assets,...extra});
 t.after(()=>{jobs.dispose();fs.rmSync(home,{recursive:true,force:true});});
 return {home,jobs};
}
const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
test('cold first training returns a preparing record instead of rejecting before asset installation',async t=>{
 let requested;
 const {jobs}=fixture(t,{prepare:async c=>{requested=c;throw Error('fixture preparation failure');}});
 const job=jobs.start({iterations:1});assert.equal(job.phase,'preparing');
 await until(()=>jobs.get(job.id).phase==='failed');
 assert.ok(requested.base_policy.endsWith('BEST_alpha_walking.onnx'));
 assert.equal(jobs.get(job.id).error,'fixture preparation failure');
});
test('cache created after the service starts is used rather than the removed bundled path',async t=>{
 let observed;
 const {home,jobs}=fixture(t,{prepare:async c=>{observed=c.base_policy;throw Error('fixture stop');}});
 const cached=path.join(policyDirectory(home),'BEST_alpha_walking.onnx');
 fs.mkdirSync(path.dirname(cached),{recursive:true});fs.writeFileSync(cached,'synthetic fixture, not weights');
 const job=jobs.start({iterations:1});await until(()=>jobs.get(job.id).phase==='failed');
 assert.equal(observed,cached);
});
test('Windows defaults never select the Apple-only MPS backend',t=>{
 const {jobs}=fixture(t,{platform:'win32',arch:'x64'});
 assert.equal(jobs.defaults().training_device,'cuda');assert.equal(jobs.holdDefaults().inference_device,'cuda');
});
test('cancelling during preparation prevents later completion from launching training',async t=>{
 let finish;const {jobs}=fixture(t,{prepare:()=>new Promise(resolve=>{finish=resolve;})});
 const job=jobs.start({iterations:1});assert.equal(jobs.cancel(job.id).phase,'cancelled');
 finish({pythonPath:'must-not-spawn'});await new Promise(r=>setTimeout(r,20));
 assert.equal(jobs.get(job.id).phase,'cancelled');
});
test('another MCP/app service can cancel a preparing job without a late failure resurrecting it',async t=>{
 let fail;const {home,jobs}=fixture(t,{prepare:()=>new Promise((_,reject)=>{fail=reject;})});
 const other=createLabJobs({home});t.after(()=>other.dispose());
 const job=jobs.start({iterations:1});assert.equal(other.cancel(job.id).phase,'cancelled');
 fail(Error('late network error'));await new Promise(r=>setTimeout(r,20));
 assert.equal(jobs.get(job.id).phase,'cancelled');
});
