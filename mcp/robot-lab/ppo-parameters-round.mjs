// Public MCP comparison; isolated metadata, global cached weights, virtual only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'ppo-parameters-check',version:'1.0.0'});
const report={jobs:[]};
const save=()=>fs.writeFileSync(process.env.DUCK_LAB_REPORT,JSON.stringify(report,null,2));
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
async function wait(id){for(let i=0;i<3600;i++){const j=await call('lab_training_get',{run_id:id});if(['completed','failed','cancelled'].includes(j.phase)){report.jobs.push(j);save();assert.equal(j.phase,'completed',j.error);return j;}await new Promise(r=>setTimeout(r,1000));}throw Error('timeout');}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp/robot-lab/server.mjs')],env:process.env,stderr:'pipe'}));
 for(const seed of [2,3])for(const profile of ['legacy-v1','local-ppo-v2']){
  let d=await call('lab_experiment_create',{name:`PPO 参数对照 ${profile} seed ${seed}`,mode:'robot',task:'microduck-headstand-hold'});
  const c=JSON.parse((await call('lab_experiment_read',{experiment_id:d.id,artifact:'training.json'})).content);
  Object.assign(c,{max_iterations:30,environments:profile==='legacy-v1'?16:32,rollout_steps:profile==='legacy-v1'?128:64,learning_rate:profile==='legacy-v1'?.0001:.0003,ppo_profile:profile,seed});
  d=await call('lab_experiment_write',{experiment_id:d.id,expected_revision:d.revision,artifact:'training.json',content:JSON.stringify(c)});
  const started=await call('lab_training_start',{experiment_id:d.id,expected_revision:d.revision});console.log(JSON.stringify({start:started.id,profile,seed}));
  const j=await wait(started.id);console.log(JSON.stringify({done:j.id,elapsed:j.metrics.at(-1)?.elapsed_seconds,candidate:j.manifest.candidate}));
  if(profile==='local-ppo-v2'&&seed===2){const r=await call('lab_training_resume',{run_id:j.id,additional_iterations:2});const child=await wait(r.id);assert.equal(child.manifest.iterations,32);assert.equal(child.manifest.ppo.profile,profile);}
 }
 report.ok=true;save();
}finally{save();await client.close();}
