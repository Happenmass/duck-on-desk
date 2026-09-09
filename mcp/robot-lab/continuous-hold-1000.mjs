// User-requested 1000-round run through public MCP; keep server alive until export.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const output=path.resolve('.release-reviews/continuous-hold-1000');
fs.mkdirSync(output,{recursive:true});
const client=new Client({name:'continuous-hold-1000',version:'1.0.0'});
const report={startedAt:new Date().toISOString()};
const save=()=>fs.writeFileSync(path.join(output,'mcp-run.json'),JSON.stringify(report,null,2));
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[process.env.DUCK_PACKAGED_SERVER||path.resolve('mcp/robot-lab/server.mjs')],env:process.env,stderr:'pipe'}));
 let draft=await call('lab_experiment_create',{name:'倒立连续恢复 · 1000 轮 · seed 2',mode:'robot',task:'microduck-headstand-hold'});
 const config=JSON.parse((await call('lab_experiment_read',{experiment_id:draft.id,artifact:'training.json'})).content);
 assert.equal(config.reset_on_pose_loss,false);assert.equal(config.hold_episode_steps,0);assert.equal(config.ppo_profile,'local-ppo-v2');
 Object.assign(config,{max_iterations:1000,policy_initialization:'random',environments:32,rollout_steps:64,learning_rate:0.0003,seed:2,training_device:'mps',inference_device:'mps'});
 draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'training.json',content:JSON.stringify(config,null,2)});
 report.experiment=draft;report.config=config;save();
 report.job=await call('lab_training_start',{experiment_id:draft.id,expected_revision:draft.revision});save();
 console.log(JSON.stringify({event:'started',id:report.job.id,config}));
 let lastLog=0;
 for(;;){
  const job=await call('lab_training_get',{run_id:report.job.id});
  report.job=job;save();
  if(Date.now()-lastLog>30000||['completed','failed','cancelled'].includes(job.phase)){
   console.log(JSON.stringify({time:new Date().toISOString(),id:job.id,phase:job.phase,progress:job.progress,metric:job.metrics?.at(-1),error:job.error,candidate:job.manifest?.candidate}));lastLog=Date.now();
  }
  if(['completed','failed','cancelled'].includes(job.phase))break;
  await new Promise(r=>setTimeout(r,5000));
 }
 report.finishedAt=new Date().toISOString();save();
 assert.equal(report.job.phase,'completed',report.job.error);
}catch(error){report.error=error.stack;save();console.error(error);process.exitCode=1;}
finally{await client.close();}
