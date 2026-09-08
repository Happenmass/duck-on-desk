'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createLabJobs}=require('../mcp/robot-lab/jobs.cjs');
const protocol=require('../src/robots/duck/pet-model-protocol');
function setup(t) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-lab-jobs-'));
  const root=path.join(tmp,'lab'),weights=path.join(tmp,'weights');
  const jobs=createLabJobs({root,weights});t.after(()=>{jobs.dispose();fs.rmSync(tmp,{recursive:true,force:true});});
  function completed(changes={}) {
    const id='run_'+randomUUID(),dir=path.join(weights,id);fs.mkdirSync(dir,{recursive:true});
    const bytes=Buffer.from('fixture policy bytes');fs.writeFileSync(path.join(dir,'policy.onnx'),bytes);
    const job={id,phase:'completed',createdAt:new Date().toISOString(),config:{},metrics:[],manifest:{contract:'duck-lab-legs-v1',native_evaluation_passed:true,baseline:{fall_rate:0,velocity_mae:.15},policy_sha256:createHash('sha256').update(bytes).digest('hex'),...changes}};
    fs.mkdirSync(path.join(root,'jobs'),{recursive:true});fs.writeFileSync(path.join(root,'jobs',id+'.json'),JSON.stringify(job));return id;
  }
  return {jobs,completed,root,weights};
}
const metrics={steps:250,nonFinite:false,fall_rate:0,velocity_mae:.14};
const evaluation=id=>({...metrics,runId:id,baseline:{...metrics,velocity_mae:.15}});
test('policy activation requires finite real-evaluation fields and native compatibility',t=>{
  const {jobs,completed}=setup(t);const id=completed();
  for(const input of [undefined,{runId:id},{...evaluation(id),velocity_mae:NaN},{...evaluation(id),steps:249},{...evaluation(id),nonFinite:true},{...evaluation(id),baseline:undefined},{...evaluation(id),runId:'wrong'},{...evaluation(id),fall_rate:1},{...evaluation(id),velocity_mae:.3}])assert.throws(()=>jobs.apply(id,input));
  assert.throws(()=>jobs.apply(completed({native_evaluation_passed:false}),evaluation(id)));
  const incompatible=completed({contract:'different'});assert.throws(()=>jobs.apply(incompatible,evaluation(incompatible)));
  assert.equal(jobs.activation().current,null);
  assert.equal(jobs.apply(id,evaluation(id)).current,id);
});
test('applying twice preserves rollback and policy hashing gates serving',t=>{
  const {jobs,completed,weights}=setup(t);const a=completed(),b=completed();
  jobs.apply(a,evaluation(a));jobs.apply(b,evaluation(b));jobs.apply(b,evaluation(b));
  assert.equal(jobs.rollback().current,a);assert.equal(jobs.rollback().current,null);
  const url=`pet-model://policy/${encodeURIComponent('lab/'+b+'/policy.onnx')}`;
  assert.equal(protocol.resolvePolicyRequest(url,{resolveLabPolicy:id=>jobs.artifact(id)}).status,200);
  fs.appendFileSync(path.join(weights,b,'policy.onnx'),'tampered');
  assert.throws(()=>jobs.artifact(b),/hash/);
  assert.equal(protocol.resolvePolicyRequest(url,{resolveLabPolicy:id=>jobs.artifact(id)}).status,404);
  assert.throws(()=>jobs.get('../outside'));assert.throws(()=>jobs.artifact(a,'../secret'));
});
test('job settings reject unbounded runs before spawning',t=>{
  const {jobs}=setup(t);
  assert.throws(()=>jobs.start({training_device:'metal'}),/Unsupported/);
  assert.throws(()=>jobs.start({reward:'x'.repeat(65537)}),/Invalid reward/);
});
