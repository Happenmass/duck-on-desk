'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const hash = value => createHash('sha256').update(value).digest('hex');
const COMMIT = '183f99a40bd7308da3e848de961ed32bb02624a5';
const CONTRACT = 'duck-lab-legs-v1';
const MAX_ITERATIONS = 2000;
const TRAINING_TIMEOUT_SECONDS = 2 * 60 * 60;
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
  const setupModule = require(path.join(__dirname,'setup.cjs'));
  const setupRuntime = setupModule.createTrainingSetup({home,platform:options.platform,arch:options.arch});
  const prepare = options.prepare || setupRuntime.prepare;
  const children = new Map(), preparing = new Map();
  let environmentState={phase:'idle',message:'首次训练会自动安装独立环境，也可以先检查并安装。'}, environmentController=null;
  const currentBase = () => options.basePolicy || cachedBase;
  function setup(input={}) {
    if(environmentController)return {...environmentState};
    const controller=new AbortController();environmentController=controller;
    environmentState={phase:'preparing',message:'正在检查训练环境'};
    const config={...defaults(),...input,asset_dir:assetDir,base_policy:currentBase()};
    Promise.resolve().then(()=>prepare(config,message=>{environmentState={phase:'preparing',message};},controller.signal))
      .then(result=>{environmentState={phase:'ready',message:'训练环境与模型已就绪',...result};})
      .catch(error=>{environmentState={phase:'failed',message:error.message};})
      .finally(()=>{environmentController=null;});
    return {...environmentState};
  }
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
  function resumeStatus(job) {
    if(!['completed','cancelled','failed'].includes(job.phase))return {available:false,reason:'请先停止当前训练，等待进度保存完成。'};
    if(!['official-full-finetune-v1','random-actor-ppo-v1'].includes(job.config?.training_method||job.manifest?.training_method))return {available:false,reason:'旧修正网络与当前官方网络不兼容，请新建训练。'};
    if(!fs.existsSync(path.join(weights,job.id,'checkpoint.pt')))return {available:false,reason:'没有保存的检查点，无法接着这条记录训练。'};
    const iteration=job.checkpoint?.iteration??job.manifest?.iterations;
    if(!Number.isInteger(iteration)||iteration<1)return {available:false,reason:'检查点进度不可用，请新建训练。'};
    return {available:true,iteration,environment_steps:job.checkpoint?.environment_steps??job.manifest?.environment_steps,
      legacy:!job.checkpoint?.version};
  }
  function summary(job) { const { config, ...rest } = job; return { ...rest, resume:resumeStatus(job),
    settings: config && { hold_episode_steps:config.hold_episode_steps??400,reset_on_pose_loss:config.reset_on_pose_loss??true,ppo_profile:config.ppo_profile||'legacy-v1',environments:config.environments,rollout_steps:config.rollout_steps,learning_rate:config.learning_rate,policy_initialization:config.policy_initialization||'official',training_method:config.training_method||job.manifest?.training_method,task:config.task||'microduck-flat-walk',action_name:config.action_name,training_device:config.training_device,inference_device:config.inference_device,target_speed:config.target_speed,iterations:config.iterations,resume_run_id:config.resume_run_id,resume_iteration:config.resume_iteration||0 } }; }
  function resume(id, input={}) {
    const parent=read(id),status=resumeStatus(parent);
    if(!status.available)throw new Error(status.reason);
    const iterations=number(input,'additional_iterations',1,MAX_ITERATIONS,true);
    const checkpoint=path.join(weights,jobId(id),'checkpoint.pt');
    const sha=hash(fs.readFileSync(checkpoint));
    if(parent.checkpoint?.sha256&&sha!==parent.checkpoint.sha256)throw new Error('Checkpoint hash mismatch');
    return start({...parent.config,hold_episode_steps:parent.config.hold_episode_steps??400,reset_on_pose_loss:parent.config.reset_on_pose_loss??true,ppo_profile:parent.config.ppo_profile||'legacy-v1',policy_initialization:parent.config.policy_initialization||'official',pythonPath:input.pythonPath||parent.config.pythonPath||defaults().pythonPath,
      iterations,source:{resume_run_id:id}}, {resume_run_id:id,resume_iteration:status.iteration,
      resume_checkpoint:checkpoint,resume_checkpoint_sha256:sha});
  }
  function defaults() {
    // Full official-network fine-tuning. Historical residual presets stay unchanged.
    const initial={reward:fs.readFileSync(path.join(__dirname,'training/default-reward.py'),'utf8'),strategy:fs.readFileSync(path.join(__dirname,'training/default-strategy.py'),'utf8'),pythonPath:process.env.DUCK_LAB_PYTHON||'',training_device:setupModule.defaultDevice(options.platform,options.arch),inference_device:setupModule.defaultDevice(options.platform,options.arch),hold_episode_steps:400,reset_on_pose_loss:true,policy_initialization:'official',ppo_profile:'local-ppo-v2',iterations:200,environments:32,rollout_steps:64,learning_rate:0.0001,target_speed:0.25,seed:2};
    try {
      const saved=JSON.parse(fs.readFileSync(path.join(root,'workbench.json'),'utf8'));
      for(const key of Object.keys(initial))if(key!=='strategy'&&saved[key]!==undefined)initial[key]=saved[key];
      const legacy=fs.readFileSync(path.join(__dirname,'presets/stable-flat-walk/strategy.py'),'utf8');
      if(saved.strategy?.trim()===legacy.trim()&&saved.learning_rate===0.001)initial.learning_rate=0.0001;
    }catch{}
    return initial;
  }
  function actionDefaults() {
    const d=defaults();return {...d,task:'microduck-headstand-dance',action_name:'倒立跳街舞',target_speed:0,
      reward:fs.readFileSync(path.join(__dirname,'training/action-reward.py'),'utf8'),strategy:fs.readFileSync(path.join(__dirname,'training/default-strategy.py'),'utf8'),
      ppo_profile:'local-ppo-v2',iterations:200,environments:32,rollout_steps:64,learning_rate:0.0001,seed:2};
  }
  function headstandDefaults() {
    return {...actionDefaults(),task:'microduck-headstand',action_name:'学会倒立',
      reward:fs.readFileSync(path.join(__dirname,'training/headstand-reward.py'),'utf8'),learning_rate:0.0001};
  }
  function holdDefaults() {
    return {...actionDefaults(),task:'microduck-headstand-hold',action_name:'倒立保持',hold_episode_steps:1500,reset_on_pose_loss:false,policy_initialization:'random',learning_rate:0.0003,
      reward:fs.readFileSync(path.join(__dirname,'training/headstand-hold-reward.py'),'utf8')};
  }
  function number(config,key,min,max,integer=false) {
    const value=Number(config[key]); if (!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) throw new Error(`Invalid ${key}: ${min}..${max}`); return value;
  }
  function start(input={}, resumed=null) {
    const c={...(input.task==='microduck-headstand-hold'?holdDefaults():input.task==='microduck-headstand'?headstandDefaults():input.task==='microduck-headstand-dance'?actionDefaults():defaults()),...input};
    const task=c.task||'microduck-flat-walk';
    if(!['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance'].includes(task))throw new Error('Unsupported training task');
    if(task!=='microduck-flat-walk')c.target_speed=0;
    if(typeof c.reset_on_pose_loss!=='boolean')throw new Error('Invalid reset_on_pose_loss');
    if(!['legacy-v1','local-ppo-v2'].includes(c.ppo_profile))throw new Error('Unsupported PPO profile');
    if(!['official','random'].includes(c.policy_initialization))throw new Error('Unsupported policy initialization');
    if (!['cpu','mps','cuda'].includes(c.training_device)||!['cpu','mps','cuda'].includes(c.inference_device)) throw new Error('Unsupported model device');
    for (const k of ['reward','strategy']) if(typeof c[k]!=='string'||Buffer.byteLength(c[k])>65536) throw new Error(`Invalid ${k} script`);
    const python=String(c.pythonPath || process.env.DUCK_LAB_PYTHON || '');
    if (/[\0\r\n]/.test(python)) throw new Error('Invalid Python executable');
    const id=`run_${randomUUID()}`;
    const config={task,hold_episode_steps:number(c,'hold_episode_steps',0,50000,true),reset_on_pose_loss:c.reset_on_pose_loss,ppo_profile:c.ppo_profile,training_method:c.policy_initialization==='random'?'random-actor-ppo-v1':'official-full-finetune-v1',policy_initialization:c.policy_initialization,action_name:String(c.action_name||'倒立跳街舞').slice(0,40),training_device:c.training_device,inference_device:c.inference_device,reward:c.reward,strategy:c.strategy,
      iterations:number(c,'iterations',1,MAX_ITERATIONS,true),environments:number(c,'environments',1,32,true),rollout_steps:number(c,'rollout_steps',8,256,true),
      learning_rate:number(c,'learning_rate',0.000001,0.01),target_speed:number(c,'target_speed',0,0.25),seed:number(c,'seed',0,2147483647,true),
      asset_dir:assetDir,base_policy:currentBase(),output_dir:path.join(weights,id),cancel_file:path.join(root,'jobs',`${id}.cancel`),max_seconds:TRAINING_TIMEOUT_SECONDS,
      preview_control_file:path.join(root,'jobs',`${id}.preview-watch.json`),preview_file:path.join(root,'jobs',`${id}.live.json`),pythonPath:python,...resumed};
    if(!c.source && task==='microduck-flat-walk')atomic(path.join(root,'workbench.json'),Object.fromEntries(Object.keys(defaults()).map(key=>[key,c[key]])));
    const job={id,ownerPid:process.pid,source:c.source||null,createdAt:new Date().toISOString(),phase:'preparing',config,metrics:[],manifest:null};
    write(job);
    const configFile=path.join(root,'jobs',`${id}.input.json`); atomic(configFile,config);
    const controller=new AbortController();preparing.set(id,{controller,job});
    const failed=error=>{
      preparing.delete(id);
      if(job.phase==='cancelled')return;
      if(fs.existsSync(config.cancel_file)){job.phase='cancelled';job.finishedAt=new Date().toISOString();write(job);return;}
      job.phase='failed';job.error=error.message;job.finishedAt=new Date().toISOString();write(job);
    };
    // Return the queued job immediately, keeping UI/MCP polling and cancellation
    // available while first-run downloads finish. The training budget starts later.
    function launch(result) {
      preparing.delete(id);
      if(controller.signal.aborted||fs.existsSync(config.cancel_file)){if(job.phase!=='cancelled'){job.phase='cancelled';job.finishedAt=new Date().toISOString();write(job);}return;}
      Object.assign(config,result);atomic(configFile,config);job.phase='starting';write(job);
      // Python bytecode inside a signed .app invalidates its resource seal after training.
      const child=spawn(config.pythonPath,['-B',path.join(__dirname,'training/train.py'),configFile],{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTORCH_ENABLE_MPS_FALLBACK:'0'},windowsHide:true});
      children.set(id,{child,job}); let buffer='';
      let graceTimer;
      const timer=setTimeout(()=>{fs.writeFileSync(config.cancel_file,'time budget');
        graceTimer=setTimeout(()=>{child.kill('SIGKILL');job.phase='failed';job.error='Training stop timed out; resume from the last saved checkpoint.';write(job);},30000);
      },config.max_seconds*1000);
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
            if(event.iteration) {job.metrics.push(event);job.progress=(event.session_iteration??event.iteration)/config.iterations;}
            if(event.checkpoint) job.checkpoint=event.checkpoint;
            if(event.restored_simulation!==undefined)job.restored_simulation=event.restored_simulation;
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
        clearTimeout(timer);clearTimeout(graceTimer);children.delete(id);
        if(!['completed','cancelled','failed'].includes(job.phase)) {job.phase='failed';job.error='Training process exited before completion. Check Python dependencies and scripts.';}
        if(code!==0&&job.phase==='completed') {job.phase='failed';job.error='Training process exited unsuccessfully';}
        job.finishedAt=new Date().toISOString(); write(job);
      });
    }
    try{
      const result=prepare(config,message=>{if(fs.existsSync(config.cancel_file)){cancel(id);return;}if(!controller.signal.aborted){job.preparation=message;write(job);}},controller.signal);
      if(result?.then)result.then(launch).catch(failed);else launch(result);
    }catch(error){failed(error);}
    return summary(job);
  }
  function cancel(id) { const pending=preparing.get(id);if(pending){pending.controller.abort();pending.job.phase='cancelled';pending.job.finishedAt=new Date().toISOString();write(pending.job);preparing.delete(id);return summary(pending.job);} const job=read(id); if(!['completed','failed','cancelled'].includes(job.phase)){fs.writeFileSync(job.config.cancel_file,'cancel');if(job.phase==='preparing'){job.phase='cancelled';job.finishedAt=new Date().toISOString();write(job);}} return summary(job); }
  function artifact(id,kind='policy.onnx') {
    if(!['policy.onnx','manifest.json','preview.json','checkpoint.pt'].includes(kind)) throw new Error('Unknown artifact');
    const job=read(id); if(kind==='checkpoint.pt') {if(!resumeStatus(job).available)throw new Error('No resumable checkpoint');}
    else if(job.phase!=='completed') throw new Error('Training has not completed');
    const result=path.join(weights,jobId(id),kind);
    if(kind==='policy.onnx'&&hash(fs.readFileSync(result))!==job.manifest.policy_sha256) throw new Error('Policy hash mismatch');
    return result;
  }
  function preview(id, enabled) {
    jobId(id);
    const job=children.get(id)?.job || read(id);
    if(typeof enabled!=='boolean')throw new Error('Preview enabled must be a boolean');
    const control=path.join(root,'jobs',`${id}.preview-watch.json`);
    if(!enabled) {fs.rmSync(control,{force:true});return {phase:job.phase,frame:null};}
    if(!job.config?.preview_file)return {phase:job.phase,frame:null,supported:false};
    if(!['completed','cancelled','failed'].includes(job.phase)) {
      let expiry=0;try{expiry=JSON.parse(fs.readFileSync(control,'utf8')).expires_at||0;}catch{}
      if(expiry<Date.now()+1500)atomic(control,{expires_at:Date.now()+3000});
    }
    let frame=null;try{frame=JSON.parse(fs.readFileSync(path.join(root,'jobs',`${id}.live.json`),'utf8'));}catch{}
    return {phase:job.phase,frame,supported:true};
  }
  function actions() {
    let entries; try { entries=JSON.parse(fs.readFileSync(path.join(root,'actions.json'),'utf8')); } catch(error) { if(error.code==='ENOENT')return [];throw error; }
    return entries.filter(entry=>{try {const job=read(entry.id);artifact(entry.id);return job.manifest.role==='action'&&job.manifest.contract==='duck-lab-action-v1'&&job.manifest.duration===8&&job.manifest.native_evaluation_passed;}catch{return false;}});
  }
  function addAction(id, name, evaluation) {
    const job=read(id);artifact(id);
    if(job.manifest.role!=='action'||job.manifest.contract!=='duck-lab-action-v1'||job.manifest.duration!==8||!job.manifest.native_evaluation_passed)throw new Error('动作尚未通过训练端的完成动作与站立检查');
    if(!evaluation||evaluation.runId!==id||evaluation.nonFinite!==false||!Number.isInteger(evaluation.steps)||evaluation.steps<400||evaluation.success!==true||!Number.isFinite(evaluation.inverted_seconds)||evaluation.inverted_seconds<0.4||!Number.isInteger(evaluation.inverted_hops)||evaluation.inverted_hops<1||evaluation.standing!==true)throw new Error('请先完成桌宠仿真中的整段动作检查');
    const label=String(name||'').trim();if(!label||label.length>40||/[\x00-\x1f]/.test(label))throw new Error('动作名称需要 1–40 个字符');
    const entries=actions().filter(entry=>entry.id!==id);
    entries.push({id,name:label,contract:job.manifest.contract,duration:job.manifest.duration,task:job.manifest.task,policy_observations:job.manifest.policy_observations});
    atomic(path.join(root,'actions.json'),entries);return entries;
  }
  function removeAction(id) {jobId(id);const entries=actions().filter(entry=>entry.id!==id);atomic(path.join(root,'actions.json'),entries);return entries;}
  function activation() { try {return JSON.parse(fs.readFileSync(path.join(root,'active-policy.json'),'utf8'));} catch(error) {if(error.code==='ENOENT')return{current:null,previous:null};throw error;} }
  function apply(id, evaluation) {
    const job=read(id);artifact(id);
    if(job.manifest.role==='action'||job.manifest.contract!==CONTRACT||!job.manifest.native_evaluation_passed) throw new Error('Native evaluation or compatibility check did not pass');
    const validMetrics = m => m && Number.isInteger(m.steps) && m.steps>=250 && m.nonFinite===false && Number.isFinite(m.fall_rate) && m.fall_rate>=0 && m.fall_rate<=1 && Number.isFinite(m.velocity_mae) && m.velocity_mae>=0;
    if(!validMetrics(evaluation)||evaluation.runId!==id||!validMetrics(evaluation.baseline)||evaluation.fall_rate>evaluation.baseline.fall_rate||evaluation.velocity_mae>evaluation.baseline.velocity_mae+0.05) throw new Error('Run the browser physics evaluation before applying this policy');
    const old=activation(); if(old.current===id)return old;
    const next={current:id,previous:old.current,evaluation,updatedAt:new Date().toISOString()};
    atomic(path.join(root,'active-policy.json'),next);return next;
  }
  function rollback() {const old=activation();if(old.previous)artifact(old.previous);const next={current:old.previous||null,previous:null,updatedAt:new Date().toISOString()};atomic(path.join(root,'active-policy.json'),next);return next;}
  function dispose() {environmentController?.abort();for(const id of preparing.keys())cancel(id);for(const {child,job} of children.values()) {fs.writeFileSync(job.config.cancel_file,'shutdown');child.kill();}children.clear();}
  return {python:()=>process.env.DUCK_LAB_PYTHON||defaults().pythonPath||environmentState.pythonPath||setupRuntime.managedPython(setupModule.defaultDevice(options.platform,options.arch)),setup,environment:()=>({...environmentState}),defaults,actionDefaults,headstandDefaults,holdDefaults,start,resume,list,get:id=>summary(read(id)),cancel,artifact,preview,actions,addAction,removeAction,activation,apply,rollback,dispose};
}
module.exports={createLabJobs};
