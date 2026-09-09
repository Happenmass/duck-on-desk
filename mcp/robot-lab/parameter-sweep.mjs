// Reproducible real-robot parameter trials through the public MCP interface.
// node mcp/robot-lab/parameter-sweep.mjs trials.json report.json
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const here=path.dirname(fileURLToPath(import.meta.url));
const trials=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const reportFile=path.resolve(process.argv[3]);
const client=new Client({name:'duck-stable-parameter-trials',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:process.env,stderr:'pipe'});
const report={created_at:new Date().toISOString(),transport:'MCP stdio / official SDK',trials:[]};
const save=()=>{fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');};
async function call(name,args={}){const r=await client.callTool({name,arguments:args});const value=r.structuredContent||JSON.parse(r.content[0].text);if(r.isError)throw Error(JSON.stringify(value));return value;}
try{
 await client.connect(transport);report.backends=await call('lab_backends_inspect');
 for(const trial of trials){
  const began=Date.now();let draft=await call('lab_experiment_create',{name:trial.name,mode:'robot'});
  const config={schema_version:1,mode:'robot',task:'microduck-flat-walk',algorithm:'ppo',physics_backend:'mujoco_cpu',training_device:'mps',inference_device:'mps',target_speed:.15,seed:0,...(trial.config_file?JSON.parse(fs.readFileSync(trial.config_file,'utf8')):trial.config)};
  const reward=fs.readFileSync(trial.reward_file||path.join(here,'training/default-reward.py'),'utf8');
  const strategy=fs.readFileSync(trial.strategy_file||path.join(here,'training/default-strategy.py'),'utf8');
  for(const [artifact,content] of Object.entries({'training.json':JSON.stringify(config,null,2),'reward.py':reward,'strategy.py':strategy}))draft=await call('lab_experiment_write',{experiment_id:draft.id,expected_revision:draft.revision,artifact,content});
  await call('lab_experiment_validate',{experiment_id:draft.id});
  const start=await call('lab_training_start',{experiment_id:draft.id,expected_revision:draft.revision});
  const record={name:trial.name,config,reward,strategy,experiment_id:draft.id,revision:draft.revision,id:start.id};report.trials.push(record);save();
  console.log(JSON.stringify({event:'started',name:trial.name,id:start.id,config}));
  let lastProgress=0;
  while(true){
   const job=await call('lab_training_get',{run_id:start.id});record.job=job;save();
   const iteration=job.metrics.at(-1)?.iteration||0;
   if(iteration>=lastProgress+25){lastProgress=iteration;console.log(JSON.stringify({event:'progress',name:trial.name,iteration,metric:job.metrics.at(-1)}));}
   if(['completed','failed','cancelled'].includes(job.phase)){
    record.wall_seconds=(Date.now()-began)/1000;
    if(job.phase==='completed')record.artifact=await call('lab_policy_artifact',{run_id:start.id});
    console.log(JSON.stringify({event:'finished',name:trial.name,phase:job.phase,error:job.error,seconds:job.metrics.at(-1)?.elapsed_seconds,manifest:job.manifest}));save();break;
   }
   if(Date.now()-began>1900000){await call('lab_training_cancel',{run_id:start.id});throw Error('Trial time budget exceeded');}
   await new Promise(r=>setTimeout(r,1000));
  }
 }
 report.finished_at=new Date().toISOString();save();
}finally{await client.close();}
