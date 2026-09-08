'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const hash = value => createHash('sha256').update(value).digest('hex');
const COMMIT = '183f99a40bd7308da3e848de961ed32bb02624a5';
const CONTRACT = 'duck-lab-legs-v1';
const jobId = id => { if (!/^run_[a-f0-9-]{36}$/.test(id || '')) throw new Error('Invalid training run ID'); return id; };
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file);
}
function createLabJobs(options = {}) {
  const home = options.home || os.homedir();
  const root = options.root || process.env.DUCK_LAB_HOME || path.join(home, '.duck-on-desk/robot-lab');
  const weights = options.weights || path.join(home, '.cache/huggingface/microduck-robot-lab');
  const assetDir = options.assetDir || process.env.DUCK_LAB_ASSET_DIR || (fs.existsSync(path.resolve(__dirname, '../app.asar'))
    ? path.resolve(__dirname, '../app.asar.unpacked/renderer-dist/robot/mjlab') : path.resolve(__dirname, '../../renderer/public/robot/mjlab'));
  const cachedBase = path.join(home, '.cache/huggingface/microduck-simulator', COMMIT, 'policies/BEST_alpha_walking.onnx');
  const basePolicy = options.basePolicy || (fs.existsSync(cachedBase) ? cachedBase : path.resolve(__dirname,'../policies/BEST_alpha_walking.onnx'));
  const children = new Map();
  const file = id => path.join(root, 'jobs', `${jobId(id)}.json`);
  function read(id) {
    const job = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    if (!['completed','cancelled','failed'].includes(job.phase) && job.ownerPid) {
      try { process.kill(job.ownerPid, 0); } catch (error) {
        if (error.code === 'ESRCH') { job.phase='failed'; job.error='The process that owned this training job has exited.'; write(job); }
      }
    }
    return job;
  }
  function write(job) { atomic(file(job.id), job); }
  function list() {
    const dir = path.join(root, 'jobs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(n => /^run_[a-f0-9-]{36}\.json$/.test(n)).map(n => read(n.slice(0,-5)))
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,30).map(summary);
  }
  function summary(job) { const { config, ...rest } = job; return { ...rest, settings: config && { training_device:config.training_device,inference_device:config.inference_device,target_speed:config.target_speed,iterations:config.iterations } }; }
  function defaults() {
    const initial={reward:fs.readFileSync(path.join(__dirname,'training/default-reward.py'),'utf8'),strategy:fs.readFileSync(path.join(__dirname,'training/default-strategy.py'),'utf8'),pythonPath:process.env.DUCK_LAB_PYTHON||'',training_device:'mps',inference_device:'mps',iterations:20,environments:4,rollout_steps:32,learning_rate:0.0003,target_speed:0.15,seed:0};
    try {const saved=JSON.parse(fs.readFileSync(path.join(root,'workbench.json'),'utf8'));for(const key of Object.keys(initial))if(saved[key]!==undefined)initial[key]=saved[key];}catch{}
    return initial;
  }
  function number(config,key,min,max,integer=false) {
    const value=Number(config[key]); if (!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) throw new Error(`Invalid ${key}: ${min}..${max}`); return value;
  }
  function start(input={}) {
    const c={...defaults(),...input};
    if (!['cpu','mps','cuda'].includes(c.training_device)||!['cpu','mps','cuda'].includes(c.inference_device)) throw new Error('Unsupported model device');
    for (const k of ['reward','strategy']) if(typeof c[k]!=='string'||Buffer.byteLength(c[k])>65536) throw new Error(`Invalid ${k} script`);
    if (!fs.existsSync(basePolicy)||!fs.existsSync(path.join(assetDir,'robot_allcollisions.xml'))) throw new Error('Microduck model / base policy unavailable; install model assets first');
    const python=String(c.pythonPath || process.env.DUCK_LAB_PYTHON || 'python3');
    if (/[\0\r\n]/.test(python)) throw new Error('Invalid Python executable');
    const id=`run_${randomUUID()}`;
    const config={training_device:c.training_device,inference_device:c.inference_device,reward:c.reward,strategy:c.strategy,
      iterations:number(c,'iterations',1,500,true),environments:number(c,'environments',1,32,true),rollout_steps:number(c,'rollout_steps',8,256,true),
      learning_rate:number(c,'learning_rate',0.000001,0.01),target_speed:number(c,'target_speed',0,0.25),seed:number(c,'seed',0,2147483647,true),
      asset_dir:assetDir,base_policy:basePolicy,output_dir:path.join(weights,id),cancel_file:path.join(root,'jobs',`${id}.cancel`),max_seconds:1800};
    if(!c.source)atomic(path.join(root,'workbench.json'),Object.fromEntries(Object.keys(defaults()).map(key=>[key,c[key]])));
    const job={id,ownerPid:process.pid,source:c.source||null,createdAt:new Date().toISOString(),phase:'starting',config,metrics:[],manifest:null};
    write(job);
    const configFile=path.join(root,'jobs',`${id}.input.json`); atomic(configFile,config);
    const child=spawn(python,[path.join(__dirname,'training/train.py'),configFile],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTORCH_ENABLE_MPS_FALLBACK:'0'},windowsHide:true});
    children.set(id,{child,job}); let buffer='';
    const timer=setTimeout(()=>{child.kill();job.phase='failed';job.error='Training exceeded 30 minutes';write(job);},1800000);
    child.stdout.on('data',chunk=>{
      buffer+=chunk;
      if(buffer.length>1024*1024) {child.kill();return;}
      let end;
      while((end=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try {
          const event=JSON.parse(line);
          if(job.phase === 'cancelled' || job.phase === 'failed') continue;
          if(typeof event.phase==='string') job.phase=event.phase;
          if(event.iteration) {job.metrics.push(event);job.progress=event.iteration/config.iterations;}
          if(event.baseline) job.baseline=event.baseline;
          if(event.manifest) job.manifest=event.manifest;
          if(event.error) job.error=event.error;
          write(job);
        } catch {}
      }
    });
    child.stderr.on('data',()=>{}); // User script output never enters the MCP transport.
    child.on('error',()=>{job.phase='failed';job.error='Unable to launch Python; select a Python environment with torch, mujoco, onnx and onnxruntime.';write(job);});
    child.on('close',code=>{
      clearTimeout(timer);children.delete(id);
      if(!['completed','cancelled','failed'].includes(job.phase)) {job.phase='failed';job.error='Training process exited before completion. Check Python dependencies and scripts.';}
      if(code!==0&&job.phase==='completed') {job.phase='failed';job.error='Training process exited unsuccessfully';}
      job.finishedAt=new Date().toISOString(); write(job);
    });
    return summary(job);
  }
  function cancel(id) { const job=read(id); if(!['completed','failed','cancelled'].includes(job.phase)) fs.writeFileSync(job.config.cancel_file,'cancel'); return summary(job); }
  function artifact(id,kind='policy.onnx') {
    if(!['policy.onnx','manifest.json','preview.json','checkpoint.pt'].includes(kind)) throw new Error('Unknown artifact');
    const job=read(id); if(job.phase!=='completed') throw new Error('Training has not completed');
    const result=path.join(weights,jobId(id),kind);
    if(kind==='policy.onnx'&&hash(fs.readFileSync(result))!==job.manifest.policy_sha256) throw new Error('Policy hash mismatch');
    return result;
  }
  function activation() { try {return JSON.parse(fs.readFileSync(path.join(root,'active-policy.json'),'utf8'));} catch(error) {if(error.code==='ENOENT')return{current:null,previous:null};throw error;} }
  function apply(id, evaluation) {
    const job=read(id);artifact(id);
    if(job.manifest.contract!==CONTRACT||!job.manifest.native_evaluation_passed) throw new Error('Native evaluation or compatibility check did not pass');
    const validMetrics = m => m && Number.isInteger(m.steps) && m.steps>=250 && m.nonFinite===false && Number.isFinite(m.fall_rate) && m.fall_rate>=0 && m.fall_rate<=1 && Number.isFinite(m.velocity_mae) && m.velocity_mae>=0;
    if(!validMetrics(evaluation)||evaluation.runId!==id||!validMetrics(evaluation.baseline)||evaluation.fall_rate>evaluation.baseline.fall_rate||evaluation.velocity_mae>evaluation.baseline.velocity_mae+0.05) throw new Error('Run the browser physics evaluation before applying this policy');
    const old=activation(); if(old.current===id)return old;
    const next={current:id,previous:old.current,evaluation,updatedAt:new Date().toISOString()};
    atomic(path.join(root,'active-policy.json'),next);return next;
  }
  function rollback() {const old=activation();if(old.previous)artifact(old.previous);const next={current:old.previous||null,previous:null,updatedAt:new Date().toISOString()};atomic(path.join(root,'active-policy.json'),next);return next;}
  function dispose() {for(const {child,job} of children.values()) {job.phase='cancelled';write(job);child.kill();}children.clear();}
  return {defaults,start,list,get:id=>summary(read(id)),cancel,artifact,activation,apply,rollback,dispose};
}
module.exports={createLabJobs};
