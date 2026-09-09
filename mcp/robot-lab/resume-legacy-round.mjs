import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');
const root=path.join(repo,'.release-reviews/resume-training/legacy-jobs');fs.mkdirSync(path.join(root,'jobs'),{recursive:true});
const old=JSON.parse(fs.readFileSync(path.join(repo,'.release-reviews/official-finetune/training.json'))).jobs;
for(const j of old)fs.copyFileSync(path.join(os.homedir(),'.duck-on-desk/robot-lab/jobs',j.id+'.json'),path.join(root,'jobs',j.id+'.json'));
const client=new Client({name:'legacy-resume-verification',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:{...process.env,DUCK_LAB_HOME:root},stderr:'pipe'});
const report={ok:false,jobs:[]};
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);};
try{
 await client.connect(transport);
 for(const parent of old){
  const before=await call('lab_training_get',{run_id:parent.id});assert.ok(before.resume.available&&before.resume.legacy);
  const child=await call('lab_training_resume',{run_id:parent.id,additional_iterations:1});
  let done;
  for(let i=0;i<300;i++){done=await call('lab_training_get',{run_id:child.id});if(['completed','failed'].includes(done.phase))break;await new Promise(r=>setTimeout(r,250));}
  report.jobs.push(done);assert.equal(done.phase,'completed',done.error);assert.equal(done.manifest.iterations,21);assert.equal(done.manifest.restored_simulation,false);
 }
 report.ok=true;
}finally{fs.writeFileSync(path.join(repo,'.release-reviews/resume-training/legacy.json'),JSON.stringify(report,null,2));await client.close();}
console.log(JSON.stringify({ok:report.ok,runs:report.jobs.map(j=>j.id)}));
