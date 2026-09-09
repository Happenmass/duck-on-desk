import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'packaged-ppo-check',version:'1.0.0'}),report={jobs:[]};
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
async function wait(id){for(let i=0;i<400;i++){const j=await call('lab_training_get',{run_id:id});if(['completed','failed','cancelled'].includes(j.phase)){assert.equal(j.phase,'completed',j.error);report.jobs.push(j);return j;}await new Promise(r=>setTimeout(r,500));}throw Error('timeout');}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[process.env.DUCK_PACKAGED_SERVER],env:process.env,stderr:'pipe'}));
 for(const task of ['microduck-flat-walk','microduck-headstand-hold']){
  let d=await call('lab_experiment_create',{name:`包内新版 PPO ${task}`,mode:'robot',task});
  const config=JSON.parse((await call('lab_experiment_read',{experiment_id:d.id,artifact:'training.json'})).content);
  assert.equal(config.ppo_profile,'local-ppo-v2');assert.equal(config.environments,32);assert.equal(config.rollout_steps,64);
  config.max_iterations=2;
  d=await call('lab_experiment_write',{experiment_id:d.id,expected_revision:d.revision,artifact:'training.json',content:JSON.stringify(config)});
  const j=await wait((await call('lab_training_start',{experiment_id:d.id,expected_revision:d.revision})).id);
  assert.equal(j.manifest.ppo.profile,'local-ppo-v2');assert.equal(j.manifest.batch_size,2048);
  assert.ok(j.manifest.onnx_export_max_error<.002);assert.equal(j.metrics.at(-1).optimizer_updates,20);
 }
 const hold=report.jobs.at(-1),child=await wait((await call('lab_training_resume',{run_id:hold.id,additional_iterations:1})).id);
 assert.equal(child.manifest.iterations,3);assert.equal(child.manifest.resume_checkpoint_sha256,hold.checkpoint.sha256);
 report.ok=true;
}finally{fs.writeFileSync(process.env.DUCK_LAB_REPORT,JSON.stringify(report,null,2));await client.close();}
