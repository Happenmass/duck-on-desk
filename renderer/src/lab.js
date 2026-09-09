import './lab.css';
import {createDuckRuntime} from './runtime/duck-runtime.js';
import {createJointConsole} from './lab-controls.js';
import {createTrainingCharts} from './lab-training-charts.js';
import {createLivePreview} from './lab-live-preview.js';
import {createLessons} from './lab-lessons.js';
const el=id=>document.getElementById(id);
const request=async(action,payload)=>{
  const result=window.robotLabAPI ? await window.robotLabAPI.request(action,payload)
    : await (await fetch('/__lab/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})})).json();
  if(result?.error)throw new Error(result.error);return result;
};
const policyUrl=name=>window.robotLabAPI?`pet-model://policy/${encodeURIComponent(name)}`:`/policies/${encodeURIComponent(name)}`;
let runtime, jointConsole, selected=null, evaluation=null, currentJob=null, closed=false, busy=false;
const trainingCharts=createTrainingCharts(el('training-charts'));
const livePreview=createLivePreview({request,notice});
const lessons=createLessons({notice});
const isHoldJob=job=>job?.settings?.task==='microduck-headstand-hold';
const usesOfficialObservations=job=>job?.manifest?.policy_observations==='official-zero-commands-v1';
const isHeadstandJob=job=>isHoldJob(job)||job?.settings?.task==='microduck-headstand';
const isActionJob=job=>isHeadstandJob(job)||job?.settings?.task==='microduck-headstand-dance';
const formFields={'reset-seconds':'hold_episode_steps','ppo-profile':'ppo_profile','policy-initialization':'policy_initialization','training-device':'training_device','inference-device':'inference_device',iterations:'iterations',environments:'environments','rollout-steps':'rollout_steps','target-speed':'target_speed','learning-rate':'learning_rate',seed:'seed',reward:'reward',strategy:'strategy',python:'pythonPath'};
function updateSamplingSummary(){
  const n=Number(el('environments').value), steps=Number(el('rollout-steps').value);
  el('sampling-summary').textContent=`每轮收集 ${n} × ${steps} = ${(n*steps).toLocaleString()} 条样本。每只机器人累计模拟 ${(steps*.02).toFixed(2)} 秒，再更新模型；${trainingTask==='microduck-headstand-hold'?(Number(el('reset-seconds').value)>0?`每 ${Number(el('reset-seconds').value)} 秒模拟时间重置到近倒立初态，失稳时继续尝试恢复`:'不按时间重置，失稳时继续尝试恢复'):'行走回合跨轮继续，到达时限或失稳时重置'}。官方 4096 × 24 = 98,304 条，可按设备调整环境数和采样步数。`;
}
for(const id of ['environments','rollout-steps','reset-seconds'])el(id).addEventListener('input',updateSamplingSummary);
const taskDrafts={};
let trainingTask='microduck-flat-walk';
function fillDraft(d){for(const [id,key] of Object.entries(formFields))el(id).value=key==='hold_episode_steps'?(d[key]??1500)/50:d[key]??(key==='policy_initialization'?'official':key==='ppo_profile'?'local-ppo-v2':'');el('target-speed').dispatchEvent(new Event('input'));updateSamplingSummary();}
el('training-task').addEventListener('change',async()=>{
  const next=el('training-task').value;el('training-task').disabled=true;
  taskDrafts[trainingTask]=Object.fromEntries(Object.entries(formFields).map(([id,key])=>[key,key==='hold_episode_steps'?Number(el(id).value)*50:el(id).value]));
  try{const d=taskDrafts[next]||await request('action-defaults',{task:next});fillDraft(d);trainingTask=next;updateSamplingSummary();selected=null;evaluation=null;lessons.setTask(next);lessons.go(0);await refresh();}
  catch(error){el('training-task').value=trainingTask;notice(error.message,true);}finally{el('training-task').disabled=false;}
});
async function showLibrary(){
  const entries=await request('actions');
  el('action-library-list').replaceChildren(...[{id:'peck',name:'啄地（预置）'},...entries].map(entry=>{
    const row=document.createElement('div');row.className='action-library-row';
    const name=document.createElement('strong');name.textContent=entry.name;
    const play=document.createElement('button');play.textContent='在实验室试播';play.disabled=!runtime||busy;
    play.onclick=async()=>{try{if(busy)return;await runtime.previewActionPolicy(entry.id==='peck'?null:await candidateUrl(entry.id),entry.id,{officialObservations:entry.policy_observations==='official-zero-commands-v1'});el('control-tab').click();notice('正在播放：停下站稳 → 动作 → 回到站立。');}catch(error){notice(error.message,true);}};
    row.append(name,play);
    if(entry.id!=='peck'){const remove=document.createElement('button');remove.textContent='移出动作库';remove.onclick=async()=>{try{await request('remove-action',{id:entry.id});await showLibrary();}catch(error){notice(error.message,true);}};row.append(remove);}
    return row;
  }));
}
function actionResult(result){
  if(result.goal==='headstand-hold'){
    const duration=`近倒立初态测试：最长连续倒立 ${result.longest_hold_seconds.toFixed(2)} 秒 · 结尾保持 ${result.hold_seconds.toFixed(2)} 秒。`;
    if(result.evaluation_version!=='headstand-hold-v1'||result.initialization!=='near-headstand')return duration+'历史保持规则，请重新检查。';
    return duration+(result.success?'通过保持练习；这不代表学会从站立翻转，暂不加入桌宠动作库。':'结尾需连续稳住 2 秒，目前尚未达到。初始倒立姿态由环境提供，不计作学会翻转。');
  }
  if(result.goal==='headstand'){
    const duration=`最长连续倒立 ${result.longest_hold_seconds.toFixed(2)} 秒 · 结尾保持 ${result.hold_seconds.toFixed(2)} 秒。`;
    if(result.evaluation_version!=='headstand-posture-v2')return duration+'这是旧版姿态规则的历史结果，请重新检查倒立保持。';
    return duration+(result.success?'通过倒立基础检查；尚未训练起身，暂不加入桌宠动作库。':'目标是头部支撑、双脚在身体上方、躯干不躺地，重心与关节稳定，结尾连续保持 2 秒；目前尚未达到。');
  }
  return `倒立 ${result.inverted_seconds.toFixed(2)} 秒 · 倒立跳动 ${result.inverted_hops} 次 · 结尾${result.standing?'站稳':'未站稳'}。${result.success?'通过动作检查；仍请目视确认动作，再添加到桌宠。':'尚未完成目标动作，不能加入随机播放。'}`;
}
const terminal=phase=>['completed','failed','cancelled'].includes(phase);
let noticeTimer, checkingEnvironment=false,showEnvironmentSetup=false;
function notice(message,error=false){el('notice').hidden=false;el('notice').textContent=message;el('notice').classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el('notice').hidden=true,6500);}
function action(id,fn){el(id).addEventListener('click',async()=>{try{await fn();}catch(error){notice(error.message,true);}});}
function displayActive(active){el('active-policy').textContent=active?.current?`桌宠当前策略：${active.current.slice(0,16)} · 可恢复上一策略`:'桌宠当前策略：内置基础策略';}
function showJob(job){
  currentJob=job;livePreview.setJob(job);lessons.update(job);
  el('policy-run-note').textContent=job.settings?.resume_run_id?`本次模型：接着第 ${job.settings.resume_iteration} 轮继续训练 · 原记录保留`:job.settings?.policy_initialization==='random'?'本次模型：官方网络结构 · 随机权重起步 · 197,774 个策略参数':(job.settings?.training_method||job.manifest?.training_method)==='official-full-finetune-v1'?'本次模型：官方原始权重 → 全量微调 · 197,774 个策略参数':'历史模型：使用旧训练方法，原始结果保留。';
  const labels={preparing:'正在准备模型与训练环境',starting:'正在启动',evaluating_baseline:'评测基础策略',training:'训练中',evaluating_candidate:'评测候选策略',completed:'训练完成',failed:'任务失败',cancelled:'已停止'};
  const unfinishedAction=job.phase==='completed'&&isActionJob(job)&&!job.manifest.native_evaluation_passed;
  el('run-status').textContent=unfinishedAction?'训练结束 · 目标未完成':labels[job.phase]||job.phase;el('run-status').classList.toggle('unfinished',unfinishedAction);
  el('training-task').disabled=busy;
  const last=job.metrics.at(-1);
  const cells=[['实际环境步数',last?.environment_steps??job.manifest?.environment_steps??0],['平均奖励',last?last.mean_reward.toFixed(3):'—'],['累计完成轮数',last?`${last.iteration} / ${last.iterations}`:(job.resume?.iteration??job.settings?.resume_iteration??'—')]];
  el('metrics').replaceChildren(...cells.map(([label,value])=>{const box=document.createElement('div');box.className='metric';const b=document.createElement('b');b.textContent=value;const span=document.createElement('span');span.textContent=label;box.append(b,span);return box;}));
  trainingCharts.update(job);
  const done=job.phase==='completed'; const actionJob=isActionJob(job);
  el('apply').textContent=isHeadstandJob(job)?'基础练习 · 暂不加入动作库':actionJob?'添加到桌宠动作库':'应用到桌宠';el('evaluate').textContent=isHeadstandJob(job)?'检查倒立保持':actionJob?'检查整段动作':'对比训练前后';el('action-name-field').hidden=!actionJob||isHeadstandJob(job);
  for(const id of ['preview','evaluate','export'])el(id).disabled=!done||busy||!runtime;
  el('apply').disabled=isHeadstandJob(job)||!done||!evaluation||evaluation.runId!==job.id||!job.manifest.native_evaluation_passed||(actionJob&&evaluation?.success!==true)||busy;
  el('runs').disabled=busy;
  for (const id of ['play','step','reset','preview','policy-control']) if(el(id))el(id).disabled=busy||!runtime||(id==='preview'&&!done);
  jointConsole?.setBusy(busy);
  el('cancel').disabled=terminal(job.phase);el('train').disabled=!terminal(job.phase)||busy;
  el('resume').disabled=!job.resume?.available||busy;
  el('resume-status').textContent=job.resume?.available?`已保存到第 ${job.resume.iteration} 轮 · 累计 ${(job.resume.environment_steps||0).toLocaleString()} 步。${job.resume.legacy?'旧检查点恢复模型与优化器，仿真从新的初态开始。':'恢复模型、优化器、仿真及随机状态。'}`:(job.resume?.reason||'这条历史记录没有可用的续训信息。');
  if(isHoldJob(job)){const steps=job.settings.hold_episode_steps??400;el('resume-status').textContent+=` 本记录${steps>0?`每 ${steps/50} 秒模拟时间重置`:'不按时间重置'}；${job.settings.reset_on_pose_loss?'失稳时也重置':'失稳时允许蹬地恢复'}。续训沿用这条记录的规则。`;}
  if(!showEnvironmentSetup){
    el('environment-status').textContent=job.error&&!job.metrics.length?job.error:job.phase==='preparing'?(job.preparation||'正在准备训练环境…'):job.preparation||'首次训练会自动安装独立环境。';
  }
  if(job.error)el('evaluation').textContent=job.error;
  else if(done&&!evaluation){const m=job.manifest;el('evaluation').textContent=actionJob?`训练端三段测试：${actionResult(m.candidate)}`:`训练前 → 训练后：平均速度误差 ${(m.baseline.velocity_mae*100).toFixed(2)} → ${(m.candidate.velocity_mae*100).toFixed(2)} 厘米 / 秒（越小越好），跌倒比例 ${(m.baseline.fall_rate*100).toFixed(0)}% → ${(m.candidate.fall_rate*100).toFixed(0)}%。${m.native_evaluation_passed?'已通过训练端初检；点击“对比训练前后”，再检查桌宠使用的仿真环境。':'未通过不退步检查，暂不能应用。可以调整奖励后重试。'}`;}
  else if(!done&&!busy)el('evaluation').textContent=job.phase==='cancelled'?(job.resume?.available?'已停止并保存进度。点击“继续这次训练”接着练；完成后再导出或检查动作。':'已停止，尚无可恢复的完整训练轮。请新建训练。'):'这次练习还在进行，完成后会显示训练前后的对比结果。';
}
async function refresh(){
  if(closed)return;
  try{if(checkingEnvironment){const state=await request('environment');el('environment-status').textContent=state.message;checkingEnvironment=state.phase==='preparing';el('setup-environment').disabled=checkingEnvironment;}
    const list=(await request('list')).filter(job=>(job.settings?.task||'microduck-flat-walk')===trainingTask);
    const ids=Array.from(el('runs').options).map(o=>o.value).filter(Boolean).join(',');
    if(ids!==list.map(j=>j.id).join(',')){el('runs').replaceChildren(...list.map(j=>new Option(`${new Date(j.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} · ${isHoldJob(j)?'倒立保持':isHeadstandJob(j)?'历史翻转练习':isActionJob(j)?'倒立跳街舞':'行走'} · ${j.settings?.iterations??'—'} 轮 · ${(j.settings?.training_device||'未知设备').toUpperCase()}`,j.id)));}
    if(!selected&&list.length)selected=list[0].id;
    if(!list.length){
      selected=null;currentJob=null;evaluation=null;livePreview.setJob(null);trainingCharts.update(null);el('policy-run-note').textContent='新训练按所选起点初始化；继续训练恢复历史检查点。';
      el('runs').replaceChildren(new Option('这门课还没有训练记录',''));el('run-status').textContent='尚未开始';el('run-status').classList.remove('unfinished');el('metrics').replaceChildren();
      el('evaluation').textContent='完成一次训练后，这里会显示真实结果。';el('lesson-run-message').textContent='选择参数后开始这次练习。';
      for(const id of ['preview','evaluate','export','apply','cancel','resume'])el(id).disabled=true;
      el('resume-status').textContent='选择一条有检查点的记录后，可继续训练。';el('train').disabled=false;el('action-name-field').hidden=trainingTask!=='microduck-headstand-dance';
    }
    if(selected){el('runs').value=selected;const job=list.find(j=>j.id===selected);if(job)showJob(job);}
  }catch(error){notice(error.message,true);}
}
el('runs').addEventListener('change',()=>{selected=el('runs').value;evaluation=null;refresh();});
action('setup-environment',async()=>{showEnvironmentSetup=true;el('setup-environment').disabled=true;try{const state=await request('setup',{pythonPath:el('python').value.trim(),training_device:el('training-device').value,inference_device:el('inference-device').value});checkingEnvironment=state.phase==='preparing';el('environment-status').textContent=state.message;}finally{el('setup-environment').disabled=checkingEnvironment;}});
action('recommended-training',async()=>{el('environments').value=32;el('rollout-steps').value=64;el('learning-rate').value=trainingTask==='microduck-headstand-hold'?0.0003:0.0001;el('ppo-profile').value='local-ppo-v2';updateSamplingSummary();notice('已填入本机新版参数；奖励脚本、起始权重和历史训练保留。');});
action('train',async()=>{showEnvironmentSetup=false;if(trainingTask==='microduck-headstand-hold'&&(!el('reset-seconds').value.trim()||!el('reset-seconds').reportValidity())){notice('重置时间请输入 0～1000 的整数秒。',true);return;}el('train').disabled=true;try{const job=await request('start',{task:trainingTask,...(trainingTask==='microduck-headstand-hold'?{hold_episode_steps:Number(el('reset-seconds').value)*50}:{}),ppo_profile:el('ppo-profile').value,policy_initialization:el('policy-initialization').value,...(trainingTask==='microduck-headstand-dance'?{action_name:el('action-name').value}:{}),pythonPath:el('python').value.trim(),training_device:el('training-device').value,inference_device:el('inference-device').value,
  iterations:Number(el('iterations').value),environments:Number(el('environments').value),rollout_steps:Number(el('rollout-steps').value),target_speed:Number(el('target-speed').value),learning_rate:Number(el('learning-rate').value),seed:Number(el('seed').value),reward:el('reward').value,strategy:el('strategy').value});selected=job.id;evaluation=null;lessons.go(2);await refresh();}catch(error){el('train').disabled=false;throw error;}});
action('resume',async()=>{showEnvironmentSetup=false;
  if(!currentJob?.resume?.available||busy)return;
  el('resume').disabled=true;
  try{const job=await request('resume',{id:selected,additional_iterations:Number(el('resume-iterations').value),pythonPath:el('python').value.trim()});
    selected=job.id;evaluation=null;lessons.go(2);await refresh();
  }catch(error){await refresh();throw error;}
});
action('cancel',async()=>{await request('cancel',{id:selected});notice('正在完成当前轮并保存进度，请等待状态变为“已停止”。');});
action('play',async()=>{const pause=runtime.labSnapshot().paused;if(pause)await runtime.labControl('velocity',{forward:Number(el('forward').value),turn:Number(el('turn').value)});await runtime.labControl(pause?'play':'pause');el('play').textContent=pause?'暂停仿真':'运行仿真';});
action('step',async()=>{await runtime.labControl('step');el('play').textContent='运行仿真';});
action('reset',async()=>{await runtime.labControl('reset');el('play').textContent='运行仿真';});
action('policy-control',async()=>{await runtime.labControl('policy');notice('已恢复行走模型。点击“运行仿真”查看动作。');});
for (const name of ['control','training']) action(`${name}-tab`,async()=>{
  const training=name==='training';
  if(training&&runtime)await runtime.labControl('pause');
  el('control-view').hidden=training;el('training-view').hidden=!training;runtime?.labView('visible',!training);livePreview.setVisible(training&&!document.hidden);
  for(const tab of ['control','training']){el(`${tab}-tab`).classList.toggle('active',tab===name);el(`${tab}-tab`).setAttribute('aria-selected',String(tab===name));}
});
async function candidateUrl(id=selected){const result=await request('policy',{id});return result.url;}
action('preview',async()=>{
  busy=true;showJob(currentJob);
  try {
    if(isActionJob(currentJob)){await runtime.previewActionPolicy(await candidateUrl(),selected,{practice:isHeadstandJob(currentJob),nearStart:isHoldJob(currentJob),officialObservations:usesOfficialObservations(currentJob)});el('control-tab').click();notice(isHoldJob(currentJob)?'从预置的近倒立姿态试播保持能力；这不是自主翻转。':'候选动作试播中。这只是预览，尚未加入桌宠。');}
    else {await runtime.labControl('pause');await runtime.loadWalkPolicy(await candidateUrl());await runtime.labControl('reset');el('forward').value=currentJob.settings.target_speed;el('turn').value=0;await runtime.labControl('velocity',{forward:currentJob.settings.target_speed,turn:0});el('control-tab').click();notice(`候选策略已载入，目标速度 ${currentJob.settings.target_speed} 米 / 秒。点击“运行仿真”查看动作。`);}
  }finally{busy=false;showJob(currentJob);}
});
action('evaluate',async()=>{
  const runId=selected,job=currentJob;busy=true;showJob(job);el('evaluation').textContent=isActionJob(job)?'正在桌宠仿真中检查完整的 8 秒动作…':'正在让训练前后的模型各试走 250 步…';
  try {
    const result=isActionJob(job)?await runtime.evaluateActionPolicy(await candidateUrl(runId),{goal:isHoldJob(job)?'headstand-hold':isHeadstandJob(job)?'headstand':'dance',officialObservations:usesOfficialObservations(job)}):await runtime.evaluateWalkPolicy(await candidateUrl(runId),job.settings.target_speed,250);
    evaluation={...result,runId};
    el('evaluation').textContent=isActionJob(job)?actionResult(result):`再次对比：平均速度误差 ${(result.baseline.velocity_mae*100).toFixed(2)} → ${(result.velocity_mae*100).toFixed(2)} 厘米 / 秒，跌倒比例 ${(result.baseline.fall_rate*100).toFixed(0)}% → ${(result.fall_rate*100).toFixed(0)}%，各试走 ${result.steps} 步。`;
    el('play').textContent='运行仿真';
  }finally{busy=false;showJob(currentJob);}
});
action('apply',async()=>{
  if(isActionJob(currentJob)){await request('add-action',{id:selected,name:el('action-name').value,evaluation});await showLibrary();notice('已加入动作库，可从 Duck 右键菜单播放，也会参与行走时的随机动作。');}
  else {displayActive(await request('apply',{id:selected,evaluation}));notice('已应用候选策略；桌宠普通脚行走将使用新策略。');}
});
action('rollback',async()=>{displayActive(await request('rollback'));notice('已恢复上一策略。');});
action('export',async()=>{const result=await request('export',{id:selected});if(result.url){const link=document.createElement('a');link.href=result.url;link.download=`${selected}.onnx`;link.click();}else if(!result.cancelled)notice(`已导出：${result.path}`);});
try{
  const bootstrap=await request('bootstrap');const d=bootstrap.defaults;
  el('reward').value=d.reward;el('strategy').value=d.strategy;el('python').value=d.pythonPath;displayActive(bootstrap.active);
  for(const [id,key] of Object.entries({'training-device':'training_device','inference-device':'inference_device',iterations:'iterations',environments:'environments','rollout-steps':'rollout_steps','target-speed':'target_speed','learning-rate':'learning_rate',seed:'seed'}))el(id).value=d[key];
  el('target-speed').dispatchEvent(new Event('input'));
  el('ppo-profile').value=d.ppo_profile||'local-ppo-v2';updateSamplingSummary();el('policy-initialization').value=d.policy_initialization||'official';taskDrafts['microduck-flat-walk']=d;el('train').disabled=false;await refresh();
  runtime=await createDuckRuntime({container:el('lab-stage'),policyUrl,mode:'lab',quality:{fps:60,shadows:true,pixelRatio:1.5}});
  for(const id of ['play','step','reset'])el(id).disabled=false;
  el('runtime-status').textContent='仿真就绪 · CPU / WASM';
  jointConsole=createJointConsole({runtime,notice});if(currentJob)showJob(currentJob);await showLibrary();runtime.labView('visible',!el('control-view').hidden);
}catch(error){el('runtime-status').textContent='加载失败';notice(error.message,true);console.error(error);}
const poll=setInterval(refresh,1000);
const telemetry=setInterval(()=>{jointConsole?.tick();if(runtime){const s=runtime.labSnapshot();el('play').textContent=s.paused?'运行仿真':'暂停仿真';}},120);
window.addEventListener('beforeunload',()=>{closed=true;clearInterval(poll);clearInterval(telemetry);clearTimeout(noticeTimer);jointConsole?.dispose();trainingCharts.dispose();livePreview.dispose();runtime?.dispose();},{once:true});

function openActionLesson(){
  if(busy)return;
  el('training-tab').click();document.querySelector('.action-library').open=true;
  if(trainingTask!=='microduck-headstand-hold'){el('training-task').value='microduck-headstand-hold';el('training-task').dispatchEvent(new Event('change'));}
}
window.robotLabAPI?.onLesson?.(lesson=>{if(lesson==='actions')openActionLesson();});
if(location.hash==='#actions')openActionLesson();

document.addEventListener('visibilitychange',()=>{livePreview.setVisible(!el('training-view').hidden&&!document.hidden);runtime?.labView('visible',!el('control-view').hidden&&!document.hidden);});
