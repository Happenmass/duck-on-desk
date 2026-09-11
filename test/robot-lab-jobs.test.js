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
test('fresh workbench uses the official mjlab walking recipe, including both scripts',t=>{
  const {jobs}=setup(t),d=jobs.defaults();
  const preset=path.join(__dirname,'../mcp/robot-lab/presets/mjlab-velocity');
  const config=JSON.parse(fs.readFileSync(path.join(preset,'training.json'),'utf8'));
  for(const key of ['training_device','inference_device','target_speed','seed','environments','rollout_steps','learning_rate','ppo_profile'])assert.equal(d[key],['training_device','inference_device'].includes(key)?require('../mcp/robot-lab/setup.cjs').defaultDevice():config[key],key);
  assert.equal(d.iterations,config.max_iterations);
  assert.equal(d.reward,fs.readFileSync(path.join(preset,'reward.py'),'utf8'));
  assert.equal(d.strategy,fs.readFileSync(path.join(preset,'strategy.py'),'utf8'));
  assert.equal(d.policy_initialization,'random');assert.match(d.reward,/reward_weights/);
});
test('saved custom workbench settings remain editable and override factory defaults',t=>{
  const {jobs,root}=setup(t);
  const custom={pythonPath:'/custom/python',iterations:37,target_speed:.2,seed:17,reward:'custom reward',strategy:'custom network'};
  fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'workbench.json'),JSON.stringify(custom));
  // A workbench saved by the retired CPU-MuJoCo recipe carries a reward_environment script the mjlab driver cannot use.
  assert.equal(jobs.defaults().iterations,200);assert.match(jobs.defaults().reward,/reward_weights/);
  fs.writeFileSync(path.join(root,'workbench.json'),JSON.stringify({...custom,recipe:'mjlab-official',policy_initialization:'official',ppo_profile:'legacy-v1'}));
  const d=jobs.defaults();for(const [key,value] of Object.entries(custom))if(key!=='strategy')assert.equal(d[key],value);
  assert.match(d.strategy,/512/);assert.doesNotMatch(d.strategy,/custom network/);
  assert.equal(d.policy_initialization,'random');assert.equal(d.ppo_profile,'mjlab-official');
  assert.equal(d.environments,256);assert.equal(d.learning_rate,.001);
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
test('environment counts above 32 reach training unchanged, while invalid counts are rejected',t=>{
  const {root,weights}=setup(t),received=[];
  const jobs=createLabJobs({root,weights,prepare:config=>{received.push(config.environments);return new Promise(()=>{});}});
  try {
    for(const task of ['microduck-flat-walk','microduck-headstand-hold']) {
      for(const environments of [33,64,4096]) {
        const job=jobs.start({task,environments});
        assert.equal(job.settings.environments,environments);
        const config=JSON.parse(fs.readFileSync(path.join(root,'jobs',job.id+'.input.json'),'utf8'));
        assert.equal(config.environments,environments);
        assert.equal(received.at(-1),environments);
        jobs.cancel(job.id);
      }
    }
    for(const environments of [0,-1,1.5,NaN,Infinity])assert.throws(()=>jobs.start({environments}),/Invalid environments/);
    assert.equal(received.length,6,'invalid counts never reach environment preparation');
    assert.equal(jobs.defaults().environments,4096,'saved user values are not clamped to the default');
  } finally {jobs.dispose();}
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

test('large training requests reach the worker unchanged without a wall-clock deadline',t=>{
 const vm=require('node:vm');const {EventEmitter}=require('node:events');
 const {root,weights}=setup(t);fs.mkdirSync(root,{recursive:true});
 const base=path.join(root,'base.fixture');fs.writeFileSync(base,'test file, not model weights');
 fs.writeFileSync(path.join(root,'robot_allcollisions.xml'),'<fixture/>');
 let launched=0;const deadlines=[];
 const filename=require.resolve('../mcp/robot-lab/jobs.cjs');const sandbox={module:{exports:{}},__dirname:path.dirname(filename),process,Buffer,AbortController,
  setTimeout:(_fn,ms)=>{deadlines.push(ms);return ms;},clearTimeout:()=>{},
  require:name=>name==='node:child_process'?{spawn:(_file,_args,options)=>{assert.equal(options.env.PYTHONUTF8,'1','Windows training must read Chinese configuration as UTF-8');launched++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',0);return child;}}:require(name)};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 const jobs=sandbox.module.exports.createLabJobs({root,weights,basePolicy:base,assetDir:root,prepare:()=>({pythonPath:'fixture-python',base_policy:base})});
 try {
  assert.equal(jobs.defaults().iterations,200);assert.equal(jobs.actionDefaults().iterations,200);
  for(const task of ['microduck-flat-walk','microduck-headstand-hold','microduck-headstand','microduck-headstand-dance']){
   const job=jobs.start({task,iterations:100000,environments:64,rollout_steps:1024,hold_episode_steps:100000,learning_rate:.1,target_speed:1.5,seed:4294967296,source:{test:true}});
   const input=JSON.parse(fs.readFileSync(path.join(root,'jobs',job.id+'.input.json'),'utf8'));
   assert.equal(job.settings.iterations,100000);assert.equal(input.iterations,100000);assert.equal(input.max_seconds,undefined);
   for(const [key,value] of Object.entries({environments:64,rollout_steps:1024,hold_episode_steps:100000,learning_rate:.1,seed:4294967296}))assert.equal(input[key],value);
   assert.equal(input.target_speed,task==='microduck-flat-walk'?1.5:0);
   assert.throws(()=>jobs.start({task,iterations:0}),/Invalid iterations/);
  }
  assert.equal(launched,4);assert.deepEqual(deadlines,[]);
 }finally{jobs.dispose();}
});

test('headstand practice stays separate from walking defaults and cannot enter the desktop action library',t=>{
 const {jobs,completed}=setup(t),headstand=jobs.headstandDefaults();
 assert.equal(headstand.task,'microduck-headstand');assert.match(headstand.reward,/head_contact/);assert.doesNotMatch(headstand.reward,/phase/);
 assert.match(jobs.actionDefaults().reward,/phase/);assert.match(jobs.defaults().reward,/track_linear_velocity/);
 const id=completed({role:'practice',contract:'duck-lab-action-v1',task:'microduck-headstand',duration:8});
 assert.throws(()=>jobs.addAction(id,'倒立',{runId:id,success:true,steps:400,nonFinite:false,inverted_seconds:4,inverted_hops:1,standing:true}));
 assert.throws(()=>jobs.apply(id,evaluation(id)));assert.equal(jobs.actions().length,0);
});

 test('near-headstand hold defaults and admission do not alter legacy entry runs',t=>{
 const {jobs,completed}=setup(t),d=jobs.holdDefaults();
 assert.equal(d.task,'microduck-headstand-hold');assert.equal(d.target_speed,0);assert.equal(d.policy_initialization,'random');assert.equal(jobs.actionDefaults().policy_initialization,'official');assert.equal(jobs.defaults().ppo_profile,'mjlab-official');
 assert.match(d.reward,/inverted\.pow\(3\)/);assert.doesNotMatch(d.reward,/reference_joint_error/);assert.doesNotMatch(jobs.headstandDefaults().reward,/reference_joint_error/);
 const id=completed({role:'practice',contract:'duck-lab-action-v1',task:d.task,duration:8});
 assert.throws(()=>jobs.addAction(id,'保持',{runId:id,success:true,steps:400,nonFinite:false,inverted_seconds:8,inverted_hops:1,standing:true}));
 assert.throws(()=>jobs.apply(id,evaluation(id)));assert.equal(jobs.actions().length,0);
 });

test('resume branches from a saved official checkpoint, preserves its recipe and rejects unsafe sources',t=>{
 const vm=require('node:vm'),{EventEmitter}=require('node:events');
 const {root,weights}=setup(t);fs.mkdirSync(root,{recursive:true});
 const base=path.join(root,'base.fixture');fs.writeFileSync(base,'fixture, not weights');fs.writeFileSync(path.join(root,'robot_allcollisions.xml'),'<fixture/>');
 const filename=require.resolve('../mcp/robot-lab/jobs.cjs');const children=[];
 const sandbox={module:{exports:{}},__dirname:path.dirname(filename),process,Buffer,AbortController,setTimeout:()=>0,clearTimeout:()=>{},
  require:name=>name==='node:child_process'?{spawn:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>c.emit('close',0);children.push(c);return c;}}:require(name)};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 const jobs=sandbox.module.exports.createLabJobs({root,weights,basePolicy:base,assetDir:root,prepare:()=>({pythonPath:'fixture-python',base_policy:base})});
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
  for(const n of [0,-1,1.5])assert.throws(()=>jobs.resume(parent.id,{additional_iterations:n}),/additional_iterations/);
  const child=jobs.resume(parent.id,{additional_iterations:100000,reward:'must not replace source'});
  const config=JSON.parse(fs.readFileSync(path.join(root,'jobs',child.id+'.input.json'),'utf8'));
  assert.notEqual(child.id,parent.id);assert.equal(config.resume_iteration,1200);assert.equal(config.iterations,100000);
  assert.equal(config.reward,jobs.holdDefaults().reward);assert.equal(config.resume_checkpoint_sha256,checkpoint.sha256);
  assert.equal(config.resume_run_id,parent.id);assert.equal(config.output_dir,path.join(weights,child.id));
  assert.equal(fs.readFileSync(path.join(root,'jobs',parent.id+'.json'),'utf8'),before);
  children[1].stdout.emit('data',JSON.stringify({phase:'training',iteration:1201,session_iteration:1})+'\n');
  assert.equal(jobs.get(child.id).progress,1/100000);
  fs.appendFileSync(path.join(dir,'checkpoint.pt'),'changed');assert.throws(()=>jobs.resume(parent.id,{additional_iterations:2}),/hash mismatch/);
  fs.unlinkSync(path.join(dir,'checkpoint.pt'));assert.equal(jobs.get(parent.id).resume.available,false);
  assert.throws(()=>jobs.resume('../outside',{additional_iterations:1}),/Invalid/);
 }finally{jobs.dispose();}
});

test('new hold drafts allow recovery, while normal walking keeps its own termination rules',t=>{
 const {jobs}=setup(t);
 assert.equal(jobs.holdDefaults().reset_on_pose_loss,false);
 // Short episodes plus reference state initialization keep the batch near the
 // target; a 1500-step episode spends ~96% of its samples collapsed on the floor.
 assert.equal(jobs.holdDefaults().hold_episode_steps,120);
 assert.equal(jobs.holdDefaults().hold_random_start,true);
 assert.equal(jobs.holdDefaults().exploration_hold_steps,4);
 assert.doesNotMatch(jobs.holdDefaults().reward,/0\.25 \* s\['feet_contact'\]/);
 // The cycle reward must not reintroduce a hold timer or an angular-speed tax.
 assert.doesNotMatch(jobs.holdDefaults().reward,/hold_seconds/);
 assert.doesNotMatch(jobs.holdDefaults().reward,/angular_speed/);
 assert.equal(jobs.start({task:'microduck-headstand-hold'}).id.startsWith('run_'),true);
 assert.equal(jobs.defaults().reset_on_pose_loss,true);
 assert.throws(()=>jobs.start({task:'microduck-headstand-hold',reset_on_pose_loss:'false'}),/Invalid reset_on_pose_loss/);
});

test('walking always runs the official mjlab driver with the fixed official recipe, and its checkpoints resume',t=>{
 const {root,weights}=setup(t);fs.mkdirSync(root,{recursive:true});
 const base=path.join(root,'base.fixture');fs.writeFileSync(base,'fixture, not weights');fs.writeFileSync(path.join(root,'robot_allcollisions.xml'),'<fixture/>');
 const vm=require('node:vm');const {EventEmitter}=require('node:events');const filename=require.resolve('../mcp/robot-lab/jobs.cjs');const spawned=[];const children=[];
 const sandbox={module:{exports:{}},__dirname:path.dirname(filename),process,Buffer,AbortController,setTimeout:()=>0,clearTimeout:()=>{},
  require:name=>name==='node:child_process'?{spawn:(_file,args)=>{spawned.push(args[1]);const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>c.emit('close',0);children.push(c);return c;}}:require(name)};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),sandbox,{filename});
 const jobs=sandbox.module.exports.createLabJobs({root,weights,basePolicy:base,assetDir:root,prepare:()=>({pythonPath:'fixture-python',base_policy:base})});
 try{
  const walk=jobs.start({task:'microduck-flat-walk',policy_initialization:'official',ppo_profile:'legacy-v1',iterations:3,source:{test:true}});
  const config=JSON.parse(fs.readFileSync(path.join(root,'jobs',walk.id+'.input.json'),'utf8'));
  assert.equal(config.training_method,'mjlab-official-v1');assert.equal(config.policy_initialization,'random');assert.equal(config.ppo_profile,'mjlab-official');
  assert.equal(config.mjlab_commit,require('../mcp/robot-lab/setup.cjs').MJLAB_COMMIT);assert.equal(config.target_speed,.25);
  assert.match(spawned[0],/train_mjlab\.py$/);
  const hold=jobs.start({task:'microduck-headstand-hold',iterations:3,source:{test:true}});
  assert.match(spawned[1],/[/\\]train\.py$/);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'jobs',hold.id+'.input.json'),'utf8')).mjlab_commit,undefined);
  const dir=path.join(weights,walk.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'checkpoint.pt'),'rsl_rl checkpoint fixture');
  children[0].stdout.emit('data',JSON.stringify({checkpoint:{version:'mjlab-rsl-rl-v1',iteration:3,environment_steps:18432,sha256:createHash('sha256').update('rsl_rl checkpoint fixture').digest('hex')}})+'\n'+JSON.stringify({phase:'cancelled'})+'\n');children[0].emit('close',0);
  assert.equal(jobs.get(walk.id).resume.available,true);
  const child=jobs.resume(walk.id,{additional_iterations:2});
  const resumed=JSON.parse(fs.readFileSync(path.join(root,'jobs',child.id+'.input.json'),'utf8'));
  assert.equal(resumed.training_method,'mjlab-official-v1');assert.equal(resumed.resume_iteration,3);assert.match(spawned[2],/train_mjlab\.py$/);
 }finally{jobs.dispose();}
});
