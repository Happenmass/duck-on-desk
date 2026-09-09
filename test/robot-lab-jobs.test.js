'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createLabJobs}=require('../mcp/robot-lab/jobs.cjs');
const protocol=require('../src/robots/duck/pet-model-protocol');
function setup(t) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-lab-jobs-'));
  const root=path.join(tmp,'lab'),weights=path.join(tmp,'weights');
  const jobs=createLabJobs({root,weights});t.after(()=>{jobs.dispose();fs.rmSync(tmp,{recursive:true,force:true});});
  function completed(changes={}) {
    const id='run_'+randomUUID(),dir=path.join(weights,id);fs.mkdirSync(dir,{recursive:true});
    const bytes=Buffer.from('fixture policy bytes');fs.writeFileSync(path.join(dir,'policy.onnx'),bytes);
    const job={id,phase:'completed',createdAt:new Date().toISOString(),config:{},metrics:[],manifest:{contract:'duck-lab-legs-v1',native_evaluation_passed:true,baseline:{fall_rate:0,velocity_mae:.15},policy_sha256:createHash('sha256').update(bytes).digest('hex'),...changes}};
    fs.mkdirSync(path.join(root,'jobs'),{recursive:true});fs.writeFileSync(path.join(root,'jobs',id+'.json'),JSON.stringify(job));return id;
  }
  return {jobs,completed,root,weights};
}
const metrics={steps:250,nonFinite:false,fall_rate:0,velocity_mae:.14};
const evaluation=id=>({...metrics,runId:id,baseline:{...metrics,velocity_mae:.15}});
test('fresh workbench uses the complete MPS walking recipe, including both scripts',t=>{
  const {jobs}=setup(t),d=jobs.defaults();
  const preset=path.join(__dirname,'../mcp/robot-lab/presets/official-finetune');
  const config=JSON.parse(fs.readFileSync(path.join(preset,'training.json'),'utf8'));
  for(const key of ['training_device','inference_device','target_speed','seed','environments','rollout_steps','learning_rate','ppo_profile'])assert.equal(d[key],config[key],key);
  assert.equal(d.iterations,config.max_iterations);
  assert.equal(d.reward,fs.readFileSync(path.join(preset,'reward.py'),'utf8'));
  assert.equal(d.strategy,fs.readFileSync(path.join(preset,'strategy.py'),'utf8'));
});
test('saved custom workbench settings remain editable and override factory defaults',t=>{
  const {jobs,root}=setup(t);
  const custom={pythonPath:'/custom/python',iterations:37,target_speed:.2,seed:17,reward:'custom reward',strategy:'custom network'};
  fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'workbench.json'),JSON.stringify(custom));
  const d=jobs.defaults();for(const [key,value] of Object.entries(custom))if(key!=='strategy')assert.equal(d[key],value);
  assert.match(d.strategy,/512/);assert.doesNotMatch(d.strategy,/custom network/);
  assert.equal(d.environments,32);assert.equal(d.learning_rate,.0001);
});
test('policy activation requires finite real-evaluation fields and native compatibility',t=>{
  const {jobs,completed}=setup(t);const id=completed();
  for(const input of [undefined,{runId:id},{...evaluation(id),velocity_mae:NaN},{...evaluation(id),steps:249},{...evaluation(id),nonFinite:true},{...evaluation(id),baseline:undefined},{...evaluation(id),runId:'wrong'},{...evaluation(id),fall_rate:1},{...evaluation(id),velocity_mae:.3}])assert.throws(()=>jobs.apply(id,input));
  assert.throws(()=>jobs.apply(completed({native_evaluation_passed:false}),evaluation(id)));
  const incompatible=completed({contract:'different'});assert.throws(()=>jobs.apply(incompatible,evaluation(incompatible)));
  assert.equal(jobs.activation().current,null);
  assert.equal(jobs.apply(id,evaluation(id)).current,id);
});
test('applying twice preserves rollback and policy hashing gates serving',t=>{
  const {jobs,completed,weights}=setup(t);const a=completed(),b=completed();
  jobs.apply(a,evaluation(a));jobs.apply(b,evaluation(b));jobs.apply(b,evaluation(b));
  assert.equal(jobs.rollback().current,a);assert.equal(jobs.rollback().current,null);
  const url=`pet-model://policy/${encodeURIComponent('lab/'+b+'/policy.onnx')}`;
  assert.equal(protocol.resolvePolicyRequest(url,{resolveLabPolicy:id=>jobs.artifact(id)}).status,200);
  fs.appendFileSync(path.join(weights,b,'policy.onnx'),'tampered');
  assert.throws(()=>jobs.artifact(b),/hash/);
  assert.equal(protocol.resolvePolicyRequest(url,{resolveLabPolicy:id=>jobs.artifact(id)}).status,404);
  assert.throws(()=>jobs.get('../outside'));assert.throws(()=>jobs.artifact(a,'../secret'));
});
test('job settings reject unbounded runs before spawning',t=>{
  const {jobs}=setup(t);
  assert.throws(()=>jobs.start({training_device:'metal'}),/Unsupported/);
  assert.throws(()=>jobs.start({reward:'x'.repeat(65537)}),/Invalid reward/);
});
test('live preview is leased only on request and returns the latest pose independently of metrics',t=>{
  const {jobs,completed,root}=setup(t);const id=completed();
  const file=path.join(root,'jobs',id+'.json'),control=path.join(root,'jobs',id+'.preview-watch.json'),live=path.join(root,'jobs',id+'.live.json');
  const job=JSON.parse(fs.readFileSync(file,'utf8'));job.phase='training';job.config.preview_file=live;
  fs.writeFileSync(file,JSON.stringify(job));
  jobs.list();assert.equal(fs.existsSync(control),false);
  assert.deepEqual(jobs.preview(id,true),{phase:'training',frame:null,supported:true});
  const expiry=JSON.parse(fs.readFileSync(control,'utf8')).expires_at;
  assert.ok(expiry>Date.now()+2500&&expiry<=Date.now()+3000);
  const frame={sequence:2,iteration:1,root:[0,0,.12,1,0,0,0],joints:Array(14).fill(0)};
  fs.writeFileSync(live,JSON.stringify(frame));assert.deepEqual(jobs.preview(id,true).frame,frame);
  assert.deepEqual(jobs.get(id).metrics,[]);
  assert.equal(JSON.parse(fs.readFileSync(control,'utf8')).expires_at,expiry,'Polling does not rewrite an unexpired lease each time');
  fs.writeFileSync(control,JSON.stringify({expires_at:Date.now()-1}));jobs.preview(id,true);
  assert.ok(JSON.parse(fs.readFileSync(control,'utf8')).expires_at>Date.now()+2500);
  jobs.preview(id,false);assert.equal(fs.existsSync(control),false);
  job.phase='completed';fs.writeFileSync(file,JSON.stringify(job));
  assert.deepEqual(jobs.preview(id,true).frame,frame);assert.equal(fs.existsSync(control),false);
});
test('live preview handles older records and rejects invalid requests',t=>{
  const {jobs,completed}=setup(t);const id=completed();
  assert.deepEqual(jobs.preview(id,true),{phase:'completed',frame:null,supported:false});
  assert.throws(()=>jobs.preview(id,'true'),/boolean/);
  assert.throws(()=>jobs.preview('../outside',true),/Invalid/);
});

test('action library admission is separate from the walking policy and requires complete action evaluation',t=>{
 const {jobs,completed}=setup(t);const id=completed({role:'action',contract:'duck-lab-action-v1',task:'microduck-headstand-dance',duration:8});
 const good={runId:id,steps:400,nonFinite:false,success:true,inverted_seconds:.5,inverted_hops:1,standing:true};
 assert.throws(()=>jobs.apply(id,evaluation(id)));
 for(const input of [undefined,{...good,runId:'wrong'},{...good,standing:false},{...good,inverted_hops:0},{...good,inverted_seconds:0},{...good,nonFinite:true},{...good,steps:399}])assert.throws(()=>jobs.addAction(id,'测试动作',input));
 assert.deepEqual(jobs.actions(),[]);jobs.addAction(id,'测试动作',good);assert.equal(jobs.actions()[0].name,'测试动作');assert.equal(jobs.activation().current,null);
 jobs.addAction(id,'改名',good);assert.equal(jobs.actions().length,1);assert.equal(jobs.actions()[0].name,'改名');
 jobs.removeAction(id);assert.deepEqual(jobs.actions(),[]);
 const failed=completed({role:'action',contract:'duck-lab-action-v1',native_evaluation_passed:false});assert.throws(()=>jobs.addAction(failed,'失败',{...good,runId:failed}));
 const walk=completed();assert.throws(()=>jobs.addAction(walk,'误用',{...good,runId:walk}));
});

test('2000-iteration jobs reach the worker config with the same two-hour timeout enforced by the parent',t=>{
 const vm=require('node:vm');const {EventEmitter}=require('node:events');
 const {root,weights}=setup(t);fs.mkdirSync(root,{recursive:true});
 const base=path.join(root,'base.fixture');fs.writeFileSync(base,'test file, not model weights');
 fs.writeFileSync(path.join(root,'robot_allcollisions.xml'),'<fixture/>');
 let launched=0;const deadlines=[];
 const filename=require.resolve('../mcp/robot-lab/jobs.cjs');const sandbox={module:{exports:{}},__dirname:path.dirname(filename),process,Buffer,
  setTimeout:(_fn,ms)=>{deadlines.push(ms);return ms;},clearTimeout:()=>{},
  require:name=>name==='node:child_process'?{spawn:()=>{launched++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',0);return child;}}:require(name)};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 const jobs=sandbox.module.exports.createLabJobs({root,weights,basePolicy:base,assetDir:root});
 try {
  assert.equal(jobs.defaults().iterations,200);assert.equal(jobs.actionDefaults().iterations,200);
  for(const task of ['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance']){
   const job=jobs.start({task,iterations:2000,source:{test:true}});
   const input=JSON.parse(fs.readFileSync(path.join(root,'jobs',job.id+'.input.json'),'utf8'));
   assert.equal(job.settings.iterations,2000);assert.equal(input.iterations,2000);assert.equal(input.max_seconds,7200);
   assert.throws(()=>jobs.start({task,iterations:2001}),/Invalid iterations/);
  }
  assert.equal(launched,4);assert.deepEqual(deadlines,[7200000,7200000,7200000,7200000]);
 }finally{jobs.dispose();}
});

test('headstand practice stays separate from walking defaults and cannot enter the desktop action library',t=>{
 const {jobs,completed}=setup(t),headstand=jobs.headstandDefaults();
 assert.equal(headstand.task,'microduck-headstand');assert.match(headstand.reward,/head_contact/);assert.doesNotMatch(headstand.reward,/phase/);
 assert.match(jobs.actionDefaults().reward,/phase/);assert.match(jobs.defaults().reward,/heading_error/);
 const id=completed({role:'practice',contract:'duck-lab-action-v1',task:'microduck-headstand',duration:8});
 assert.throws(()=>jobs.addAction(id,'倒立',{runId:id,success:true,steps:400,nonFinite:false,inverted_seconds:4,inverted_hops:1,standing:true}));
 assert.throws(()=>jobs.apply(id,evaluation(id)));assert.equal(jobs.actions().length,0);
});

 test('near-headstand hold defaults and admission do not alter legacy entry runs',t=>{
 const {jobs,completed}=setup(t),d=jobs.holdDefaults();
 assert.equal(d.task,'microduck-headstand-hold');assert.equal(d.target_speed,0);assert.equal(d.policy_initialization,'random');assert.equal(jobs.defaults().policy_initialization,'official');
 assert.match(d.reward,/torch.acos/);assert.doesNotMatch(d.reward,/reference_joint_error/);assert.doesNotMatch(jobs.headstandDefaults().reward,/reference_joint_error/);
 const id=completed({role:'practice',contract:'duck-lab-action-v1',task:d.task,duration:8});
 assert.throws(()=>jobs.addAction(id,'保持',{runId:id,success:true,steps:400,nonFinite:false,inverted_seconds:8,inverted_hops:1,standing:true}));
 assert.throws(()=>jobs.apply(id,evaluation(id)));assert.equal(jobs.actions().length,0);
 });

test('resume branches from a saved official checkpoint, preserves its recipe and rejects unsafe sources',t=>{
 const vm=require('node:vm'),{EventEmitter}=require('node:events');
 const {root,weights}=setup(t);fs.mkdirSync(root,{recursive:true});
 const base=path.join(root,'base.fixture');fs.writeFileSync(base,'fixture, not weights');fs.writeFileSync(path.join(root,'robot_allcollisions.xml'),'<fixture/>');
 const filename=require.resolve('../mcp/robot-lab/jobs.cjs');const children=[];
 const sandbox={module:{exports:{}},__dirname:path.dirname(filename),process,Buffer,setTimeout:()=>0,clearTimeout:()=>{},
  require:name=>name==='node:child_process'?{spawn:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>c.emit('close',0);children.push(c);return c;}}:require(name)};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 const jobs=sandbox.module.exports.createLabJobs({root,weights,basePolicy:base,assetDir:root});
 try{
  const parent=jobs.start({task:'microduck-headstand-hold',iterations:2000,source:{test:true}});
  assert.throws(()=>jobs.resume(parent.id,{additional_iterations:3}),/停止/);
  const dir=path.join(weights,parent.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'checkpoint.pt'),'checkpoint fixture');
  const checkpoint={iteration:1200,environment_steps:1228800,sha256:createHash('sha256').update('checkpoint fixture').digest('hex'),version:2};
  children[0].stdout.emit('data',JSON.stringify({checkpoint})+'\n'+JSON.stringify({phase:'cancelled'})+'\n');children[0].emit('close',0);
  const before=fs.readFileSync(path.join(root,'jobs',parent.id+'.json'),'utf8');
  assert.equal(jobs.get(parent.id).resume.available,true);
  assert.equal(jobs.artifact(parent.id,'checkpoint.pt'),path.join(dir,'checkpoint.pt'));
  assert.throws(()=>jobs.artifact(parent.id),/not completed/);
  for(const n of [0,2001,1.5])assert.throws(()=>jobs.resume(parent.id,{additional_iterations:n}),/additional_iterations/);
  const child=jobs.resume(parent.id,{additional_iterations:2000,reward:'must not replace source'});
  const config=JSON.parse(fs.readFileSync(path.join(root,'jobs',child.id+'.input.json'),'utf8'));
  assert.notEqual(child.id,parent.id);assert.equal(config.resume_iteration,1200);assert.equal(config.iterations,2000);
  assert.equal(config.reward,jobs.holdDefaults().reward);assert.equal(config.resume_checkpoint_sha256,checkpoint.sha256);
  assert.equal(config.resume_run_id,parent.id);assert.equal(config.output_dir,path.join(weights,child.id));
  assert.equal(fs.readFileSync(path.join(root,'jobs',parent.id+'.json'),'utf8'),before);
  children[1].stdout.emit('data',JSON.stringify({phase:'training',iteration:1201,session_iteration:1})+'\n');
  assert.equal(jobs.get(child.id).progress,1/2000);
  fs.appendFileSync(path.join(dir,'checkpoint.pt'),'changed');assert.throws(()=>jobs.resume(parent.id,{additional_iterations:2}),/hash mismatch/);
  fs.unlinkSync(path.join(dir,'checkpoint.pt'));assert.equal(jobs.get(parent.id).resume.available,false);
  assert.throws(()=>jobs.resume('../outside',{additional_iterations:1}),/Invalid/);
 }finally{jobs.dispose();}
});

test('new hold drafts allow recovery, while normal walking keeps its own termination rules',t=>{
 const {jobs}=setup(t);
 assert.equal(jobs.holdDefaults().reset_on_pose_loss,false);
 assert.equal(jobs.holdDefaults().hold_episode_steps,1500);
 assert.doesNotMatch(jobs.holdDefaults().reward,/0\.25 \* s\['feet_contact'\]/);
 assert.equal(jobs.defaults().reset_on_pose_loss,true);
 assert.throws(()=>jobs.start({task:'microduck-headstand-hold',reset_on_pose_loss:'false'}),/Invalid reset_on_pose_loss/);
});
