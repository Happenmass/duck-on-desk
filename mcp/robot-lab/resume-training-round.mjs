// Real MCP resume/stop checks; all new weights remain in the global HF cache.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const client=new Client({name:'resume-training-verification',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:process.env,stderr:'pipe'});
const report={jobs:[],ok:false},out=process.env.DUCK_LAB_REPORT;
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
async function wait(id,stopAt=0){
 let cancelled=false;
 for(let i=0;i<1200;i++){
  const j=await call('lab_training_get',{run_id:id});
  if(stopAt&&!cancelled&&j.checkpoint?.iteration>=stopAt){
   assert.equal(j.resume.available,false,'Running checkpoints cannot be resumed concurrently');
   await call('lab_training_cancel',{run_id:id});cancelled=true;
  }
  if(['completed','failed','cancelled'].includes(j.phase)){report.jobs.push(j);save();assert.notEqual(j.phase,'failed',j.error);return j;}
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('Resume verification timed out');
}
try{
 await client.connect(transport);
 for(const task of ['microduck-flat-walk','microduck-headstand-hold']){
  let d=await call('lab_experiment_create',{name:`续训核验 ${task}`,mode:'robot',task});
  const c=JSON.parse((await call('lab_experiment_read',{experiment_id:d.id,artifact:'training.json'})).content);
  c.max_iterations=task==='microduck-flat-walk'?12:100;c.environments=2;c.rollout_steps=32;
  d=await call('lab_experiment_write',{experiment_id:d.id,expected_revision:d.revision,artifact:'training.json',content:JSON.stringify(c)});
  const started=await call('lab_training_start',{experiment_id:d.id,expected_revision:d.revision});
  const parent=await wait(started.id,task==='microduck-headstand-hold'?10:0);
  assert.equal(parent.phase,task==='microduck-flat-walk'?'completed':'cancelled');assert.ok(parent.resume.available);
  const artifact=await call('lab_policy_artifact',{run_id:parent.id,kind:'checkpoint.pt'});assert.ok(fs.existsSync(artifact.path));
  const child=await call('lab_training_resume',{run_id:parent.id,additional_iterations:3});
  assert.notEqual(child.id,parent.id);assert.equal(child.settings.resume_iteration,parent.resume.iteration);
  const done=await wait(child.id);assert.equal(done.phase,'completed');assert.equal(done.restored_simulation,true);
  assert.equal(done.manifest.iterations,parent.resume.iteration+3);
  assert.equal(done.manifest.environment_steps,parent.resume.environment_steps+3*2*32);
  assert.equal(done.metrics[0].iteration,parent.resume.iteration+1);assert.equal(done.progress,1);
  assert.equal(done.manifest.resume_checkpoint_sha256,parent.checkpoint.sha256);
  assert.ok(Object.values(done.manifest.parameter_changes).every(x=>x>0));
  const unchanged=await call('lab_training_get',{run_id:parent.id});assert.equal(unchanged.checkpoint.sha256,parent.checkpoint.sha256);
  console.log(JSON.stringify({task,parent:parent.id,child:done.id,iterations:done.manifest.iterations}));
 }
 report.ok=true;save();
}finally{save();await client.close();}
