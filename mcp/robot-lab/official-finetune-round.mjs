// Exercise both lessons through public MCP; never activate policies or contact hardware.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const client=new Client({name:'official-finetune-verification',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:process.env,stderr:'pipe'});
const report={scope:'real virtual PPO, official pretrained actor, no hardware or activation',jobs:[]};
const output=process.env.DUCK_LAB_REPORT;
const save=()=>{if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');};
async function call(name,args={}){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);}
try{
  await client.connect(transport);
  for(const task of ['microduck-flat-walk','microduck-headstand-hold']){
    let draft=await call('lab_experiment_create',{name:`官方原始网络全量微调核验：${task}`,mode:'robot',task});
    const c=JSON.parse((await call('lab_experiment_read',{experiment_id:draft.id,artifact:'training.json'})).content);
    c.max_iterations=20;
    draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'training.json',content:JSON.stringify(c)});
    await call('lab_experiment_validate',{experiment_id:draft.id});
    const started=await call('lab_training_start',{experiment_id:draft.id,expected_revision:draft.revision});
    console.log(JSON.stringify({task,run:started.id}));
    let job;const until=Date.now()+900000;
    while(Date.now()<until){job=await call('lab_training_get',{run_id:started.id});if(['completed','failed','cancelled'].includes(job.phase))break;await new Promise(r=>setTimeout(r,2000));}
    report.jobs.push(job);save();assert.equal(job.phase,'completed',job.error);
    const m=job.manifest;
    assert.equal(m.training_method,'official-full-finetune-v1');assert.equal(m.trainable_policy_parameters,197774);
    assert.deepEqual(m.policy_architecture,[61,512,256,128,14]);
    assert.ok(Object.values(m.parameter_changes).every(v=>v>0),'Each original weight/bias tensor must update');
    assert.ok(m.base_import_max_error<.002&&m.onnx_export_max_error<.002);
    await call('lab_policy_artifact',{run_id:job.id});
    console.log(JSON.stringify({task,run:job.id,manifest:m}));
  }
  assert.equal(report.jobs[0].manifest.initial_policy_sha256,report.jobs[1].manifest.initial_policy_sha256);
  report.ok=true;save();
}finally{save();await client.close();}
