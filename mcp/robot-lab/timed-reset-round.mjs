// Real local MuJoCo/MPS rollouts through MCP. No policy activation or hardware.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const client=new Client({name:'timed-reset-check',version:'1.0.0'}),report={jobs:[]};
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
const save=()=>fs.writeFileSync(process.env.DUCK_LAB_REPORT,JSON.stringify(report,null,2));
async function wait(id){for(let i=0;i<800;i++){const j=await call('lab_training_get',{run_id:id});if(['completed','failed','cancelled'].includes(j.phase)){report.jobs.push(j);save();assert.equal(j.phase,'completed',j.error);return j;}await new Promise(r=>setTimeout(r,500));}throw Error('timeout');}
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[process.env.DUCK_PACKAGED_SERVER||path.resolve('mcp/robot-lab/server.mjs')],env:process.env,stderr:'pipe'}));
 let d=await call('lab_experiment_create',{name:'30秒定时重置与续训核验',mode:'robot',task:'microduck-headstand-hold'});
 const config=JSON.parse((await call('lab_experiment_read',{experiment_id:d.id,artifact:'training.json'})).content);
 assert.equal(config.reset_on_pose_loss,false);assert.equal(config.hold_episode_steps,1500);assert.equal(config.ppo_profile,'local-ppo-v2');
 config.max_iterations=24;
 d=await call('lab_experiment_write',{experiment_id:d.id,expected_revision:d.revision,artifact:'training.json',content:JSON.stringify(config)});
 const parent=await wait((await call('lab_training_start',{experiment_id:d.id,expected_revision:d.revision})).id);
 assert.equal(parent.manifest.reset_on_pose_loss,false);
 assert.equal(parent.metrics.reduce((n,m)=>n+m.failure_resets,0),0);
 assert.equal(parent.metrics.reduce((n,m)=>n+m.timeout_resets,0),32);
 assert.ok(parent.manifest.onnx_export_max_error<.002);
 const child=await wait((await call('lab_training_resume',{run_id:parent.id,additional_iterations:2})).id);
 assert.equal(child.manifest.iterations,26);assert.equal(child.manifest.reset_on_pose_loss,false);
 assert.equal(child.metrics.reduce((n,m)=>n+m.failure_resets,0),0);
 assert.equal(child.metrics.reduce((n,m)=>n+m.timeout_resets,0),0);
 assert.equal(child.settings.hold_episode_steps,1500); report.ok=true;save();console.log(JSON.stringify({ok:true,parent:parent.id,child:child.id,candidate:child.manifest.candidate}));
}finally{save();await client.close();}
