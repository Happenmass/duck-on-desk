import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const client=new Client({name:'coding-agent-real-training',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:process.env,stderr:'pipe'});
const report={timestamp:new Date().toISOString(),transport:'MCP stdio / official SDK',calls:[],cuda_status:'pending_hardware_verification'};
async function call(name,args={}) {
  const r=await client.callTool({name,arguments:args});const value=r.structuredContent||JSON.parse(r.content[0].text);
  assert.ok(!r.isError,JSON.stringify(value));report.calls.push(name);return value;
}
async function finished(id) {
  const deadline=Date.now()+120000;
  while(Date.now()<deadline) {
    const job=await call('lab_training_get',{run_id:id});
    if(['completed','failed','cancelled'].includes(job.phase))return job;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('Training did not finish within 120 seconds');
}
try {
  await client.connect(transport);
  await call('lab_docs_search',{query:'real PPO reward_environment',limit:5});
  const defaults=await call('lab_training_defaults');
  let draft=await call('lab_experiment_create',{name:'First real MPS robot training through MCP',mode:'robot'});
  // Bound this protocol smoke test independently of the full walking defaults.
  draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'training.json',content:JSON.stringify({schema_version:1,mode:'robot',task:'microduck-flat-walk',algorithm:'ppo',physics_backend:'mujoco_cpu',training_device:'mps',inference_device:'mps',max_iterations:20,environments:4,rollout_steps:32,learning_rate:0.0003,target_speed:0.15,seed:0},null,2)});
  draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'reward.py',content:defaults.reward.replace('0.002','0.0025')});
  draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'strategy.py',content:defaults.strategy});
  await call('lab_experiment_validate',{experiment_id:draft.id});
  const job=await call('lab_training_start',{experiment_id:draft.id,expected_revision:draft.revision});
  report.job=await finished(job.id);
  assert.equal(report.job.phase,'completed',report.job.error);
  assert.equal(report.job.manifest.training_device,'mps');assert.equal(report.job.manifest.inference_device,'mps');
  assert.equal(report.job.manifest.environment_steps,2560);
  assert.ok(report.job.manifest.parameter_l1_change>0);
  assert.ok(report.job.manifest.onnx_export_max_error<0.002);
  report.artifact=await call('lab_policy_artifact',{run_id:job.id});
  assert.ok(fs.statSync(report.artifact.path).size>100000);
  const next=await call('lab_training_start',{experiment_id:draft.id,expected_revision:draft.revision});
  await call('lab_training_cancel',{run_id:next.id});
  assert.equal((await finished(next.id)).phase,'cancelled');
  report.cancelled_job=next.id;report.ok=true;
} finally {await client.close();}
if(process.env.DUCK_LAB_REPORT)fs.writeFileSync(process.env.DUCK_LAB_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,run:report.job.id,manifest:report.job.manifest,call_count:report.calls.length,cancelled:report.cancelled_job},null,2));
