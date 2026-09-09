import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('fresh MCP robot drafts inherit the official full-finetuning settings and both scripts', { timeout: 20000 }, async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'duck-defaults-protocol-'));
  const here=fileURLToPath(new URL('../',import.meta.url));
  const client=new Client({name:'defaults-regression',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:{...process.env,DUCK_LAB_HOME:root},stderr:'pipe'});
  async function call(name,args={}) {
    const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));
    return result.structuredContent||JSON.parse(result.content[0].text);
  }
  try {
    await client.connect(transport);
    const d=await call('lab_training_defaults');
    const draft=await call('lab_experiment_create',{name:'Verified default recipe',mode:'robot'});
    for(const artifact of ['training.json','reward.py','strategy.py']) {
      const saved=await call('lab_experiment_read',{experiment_id:draft.id,artifact});
      const expected=fs.readFileSync(path.join(here,'presets/official-finetune',artifact),'utf8');
      if(artifact==='training.json')assert.deepEqual(JSON.parse(saved.content),JSON.parse(expected));
      else {assert.equal(saved.content,expected);assert.equal(saved.content,d[artifact==='reward.py'?'reward':'strategy']);}
    }
    assert.equal((await call('lab_training_list')).jobs.length,0,'Reading defaults and creating a draft do not start training');
    let hold=await call('lab_experiment_create',{name:'Timed hold',mode:'robot',task:'microduck-headstand-hold'});
    const settings=JSON.parse((await call('lab_experiment_read',{experiment_id:hold.id,artifact:'training.json'})).content);
    assert.equal(settings.hold_episode_steps,1500);assert.equal(settings.reset_on_pose_loss,false);
    settings.hold_episode_steps=0;
    hold=await call('lab_experiment_write',{experiment_id:hold.id,expected_revision:hold.revision,artifact:'training.json',content:JSON.stringify(settings)});
    assert.equal(JSON.parse((await call('lab_experiment_read',{experiment_id:hold.id,artifact:'training.json'})).content).hold_episode_steps,0);
  } finally {await client.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('MCP protocol: docs, versioned writes, invalid drafts, CPU and available GPU execution', { timeout: 180000 }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../first-round.mjs', import.meta.url))], { env: process.env, timeout: 170000, maxBuffer: 1024 * 1024 });
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.tool_count, 16);
  assert.ok(report.call_count >= 20);
});

test('MCP validates 2000-iteration drafts for all lesson tasks and rejects 2001 before execution', {timeout:20000}, async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'duck-iteration-protocol-'));
 const here=fileURLToPath(new URL('../',import.meta.url));const client=new Client({name:'iteration-limit-check',version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:{...process.env,DUCK_LAB_HOME:root},stderr:'pipe'});
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
 try{
  await client.connect(transport);
  for(const task of ['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance']){
   let draft=await call('lab_experiment_create',{name:'2000 iteration validation',mode:'robot',task});
   const config=JSON.parse((await call('lab_experiment_read',{experiment_id:draft.id,artifact:'training.json'})).content);assert.equal(config.max_iterations,200);
   config.max_iterations=2000;
   draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'training.json',content:JSON.stringify(config)});
   await call('lab_experiment_validate',{experiment_id:draft.id});
   config.max_iterations=2001;
   await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact:'training.json',content:JSON.stringify(config)});
   const rejected=await client.callTool({name:'lab_experiment_validate',arguments:{experiment_id:draft.id}});assert.equal(rejected.isError,true);assert.equal(rejected.structuredContent.code,'INVALID_CONFIG');
  }
  assert.equal((await call('lab_training_list')).jobs.length,0);
 }finally{await client.close();fs.rmSync(root,{recursive:true,force:true});}
});
