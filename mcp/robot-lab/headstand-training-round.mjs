// Virtual-only first action experiment through the public MCP transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const client=new Client({name:'duck-headstand-first-round',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:process.env,stderr:'pipe'});
const report={time:new Date().toISOString(),scope:'virtual MuJoCo, MCP, no hardware',calls:[],cuda:'pending_hardware_verification'};
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});const value=r.structuredContent||JSON.parse(r.content[0].text);assert.ok(!r.isError,JSON.stringify(value));report.calls.push(name);return value;};
try {
 await client.connect(transport);
 await call('lab_docs_search',{query:'action headstand phase'});
 let draft=await call('lab_experiment_create',{name:'第二课：倒立保持 · 真实训练',mode:'robot',task:process.env.DUCK_HEADSTAND_TASK||'microduck-headstand-hold'});
 const settings=JSON.parse((await call('lab_experiment_read',{experiment_id:draft.id,artifact:'training.json'})).content);
 if(process.env.DUCK_HEADSTAND_ITERATIONS)settings.max_iterations=Number(process.env.DUCK_HEADSTAND_ITERATIONS);
 if(process.env.DUCK_HEADSTAND_DEVICE)settings.training_device=settings.inference_device=process.env.DUCK_HEADSTAND_DEVICE;
 draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'training.json',content:JSON.stringify(settings,null,2)});
 await call('lab_experiment_validate',{experiment_id:draft.id});
 const job=await call('lab_training_start',{experiment_id:draft.id,expected_revision:draft.revision});
 console.log(JSON.stringify({run:job.id,phase:job.phase}));
 const until=Date.now()+7200000;
 while(Date.now()<until){
  const j=await call('lab_training_get',{run_id:job.id});
  console.log(JSON.stringify({phase:j.phase,iteration:j.metrics.at(-1)?.iteration}));
  if(['completed','failed','cancelled'].includes(j.phase)){report.job=j;break;}
  await new Promise(r=>setTimeout(r,5000));
 }
 assert.equal(report.job?.phase,'completed',report.job?.error||'Training timed out');
 assert.equal(report.job.manifest.role,'practice');assert.equal(report.job.manifest.environment_steps,settings.max_iterations*settings.environments*settings.rollout_steps);
 report.artifact=await call('lab_policy_artifact',{run_id:job.id});
 report.library=await call('lab_actions_list');report.transport_ok=true;
}finally{
 await client.close();
 const output=path.resolve(process.env.DUCK_LAB_REPORT||path.join(here,'../../.release-reviews/headstand/first-training.json'));
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({run:report.job.id,manifest:report.job.manifest},null,2));
