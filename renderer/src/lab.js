import './lab.css';
import {createDuckRuntime} from './runtime/duck-runtime.js';
const el=id=>document.getElementById(id);
const request=async(action,payload)=>{
  const result=window.robotLabAPI ? await window.robotLabAPI.request(action,payload)
    : await (await fetch('/__lab/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})})).json();
  if(result?.error)throw new Error(result.error);return result;
};
const policyUrl=name=>window.robotLabAPI?`pet-model://policy/${encodeURIComponent(name)}`:`/policies/${encodeURIComponent(name)}`;
let runtime, selected=null, evaluation=null, currentJob=null, closed=false, busy=false;
const terminal=phase=>['completed','failed','cancelled'].includes(phase);
let noticeTimer;
function notice(message,error=false){el('notice').hidden=false;el('notice').textContent=message;el('notice').classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el('notice').hidden=true,6500);}
function action(id,fn){el(id).addEventListener('click',async()=>{try{await fn();}catch(error){notice(error.message,true);}});}
function displayActive(active){el('active-policy').textContent=active?.current?`桌宠当前策略：${active.current.slice(0,16)} · 可恢复上一策略`:'桌宠当前策略：内置基础策略';}
function showJob(job){
  currentJob=job;
  const labels={starting:'正在启动',evaluating_baseline:'评测基础策略',training:'训练中',evaluating_candidate:'评测候选策略',completed:'训练完成',failed:'任务失败',cancelled:'已停止'};
  el('run-status').textContent=labels[job.phase]||job.phase;
  const last=job.metrics.at(-1);
  const cells=[['实际环境步数',last?.environment_steps??job.manifest?.environment_steps??0],['平均奖励',last?last.mean_reward.toFixed(3):'—'],['完成轮数',last?`${last.iteration} / ${last.iterations}`:'—']];
  el('metrics').replaceChildren(...cells.map(([label,value])=>{const box=document.createElement('div');box.className='metric';const b=document.createElement('b');b.textContent=value;const span=document.createElement('span');span.textContent=label;box.append(b,span);return box;}));
  const canvas=el('chart'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const values=job.metrics.map(m=>m.mean_reward);
  if(values.length){const lo=Math.min(...values)-0.02,hi=Math.max(...values)+0.02;ctx.strokeStyle='#314254';ctx.beginPath();ctx.moveTo(20,140);ctx.lineTo(780,140);ctx.stroke();ctx.strokeStyle='#84d6c4';ctx.lineWidth=2;ctx.beginPath();values.forEach((v,i)=>{const x=20+760*i/Math.max(1,values.length-1),y=130-110*(v-lo)/(hi-lo);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();ctx.fillStyle='#8aa5b7';ctx.font='12px monospace';ctx.fillText('MEAN REWARD / ITERATION',20,18);}
  const done=job.phase==='completed';
  for(const id of ['preview','evaluate','export'])el(id).disabled=!done||busy||!runtime;
  el('apply').disabled=!done||!evaluation||evaluation.runId!==job.id||!job.manifest.native_evaluation_passed||busy;
  el('runs').disabled=busy;
  for (const id of ['play','step','reset','preview','policy-control']) if(el(id))el(id).disabled=busy||!runtime||(id==='preview'&&!done);
  for(const slider of el('joints').querySelectorAll('input'))slider.disabled=busy;
  el('cancel').disabled=terminal(job.phase);el('train').disabled=!terminal(job.phase);
  if(job.error)el('evaluation').textContent=job.error;
  else if(done&&!evaluation){const m=job.manifest;el('evaluation').textContent=`原生评测：速度误差 ${m.baseline.velocity_mae.toFixed(4)} → ${m.candidate.velocity_mae.toFixed(4)} m/s，跌倒率 ${(m.candidate.fall_rate*100).toFixed(0)}%。${m.native_evaluation_passed?'可继续浏览器物理评测。':'未通过不退步检查，禁止应用。'}`;}
}
async function refresh(){
  if(closed)return;
  try{const list=await request('list');
    const ids=Array.from(el('runs').options).map(o=>o.value).filter(Boolean).join(',');
    if(ids!==list.map(j=>j.id).join(',')){el('runs').replaceChildren(...list.map(j=>new Option(`${j.createdAt.slice(11,19)} · ${j.id.slice(0,12)}`,j.id)));}
    if(!selected&&list.length)selected=list[0].id;
    if(selected){el('runs').value=selected;const job=list.find(j=>j.id===selected);if(job)showJob(job);}
  }catch(error){notice(error.message,true);}
}
el('runs').addEventListener('change',()=>{selected=el('runs').value;evaluation=null;refresh();});
action('train',async()=>{el('train').disabled=true;try{const job=await request('start',{pythonPath:el('python').value.trim(),training_device:el('training-device').value,inference_device:el('inference-device').value,
  iterations:Number(el('iterations').value),environments:Number(el('environments').value),rollout_steps:Number(el('rollout-steps').value),target_speed:Number(el('target-speed').value),learning_rate:Number(el('learning-rate').value),seed:Number(el('seed').value),reward:el('reward').value,strategy:el('strategy').value});selected=job.id;evaluation=null;await refresh();}catch(error){el('train').disabled=false;throw error;}});
action('cancel',()=>request('cancel',{id:selected}));
action('play',async()=>{const pause=runtime.labSnapshot().paused;if(pause)await runtime.labControl('velocity',{forward:Number(el('forward').value),turn:Number(el('turn').value)});await runtime.labControl(pause?'play':'pause');el('play').textContent=pause?'暂停仿真':'运行仿真';});
action('step',async()=>{await runtime.labControl('step');el('play').textContent='运行仿真';});
action('reset',async()=>{await runtime.labControl('reset');el('play').textContent='运行仿真';});
action('policy-control',()=>runtime.labControl('policy'));
async function candidateUrl(id=selected){const result=await request('policy',{id});return result.url;}
action('preview',async()=>{busy=true;showJob(currentJob);try{await runtime.labControl('pause');await runtime.loadWalkPolicy(await candidateUrl());await runtime.labControl('reset');notice('候选策略已载入实验室。点击运行查看。');}finally{busy=false;showJob(currentJob);}});
action('evaluate',async()=>{const runId=selected;const target=currentJob.settings.target_speed;busy=true;showJob(currentJob);el('evaluation').textContent='正在用浏览器 MuJoCo 对基础和候选策略各评测 250 步…';try{const result=await runtime.evaluateWalkPolicy(await candidateUrl(runId),target,250);evaluation={...result,runId};el('evaluation').textContent=`浏览器评测：速度误差 ${result.baseline.velocity_mae.toFixed(4)} → ${result.velocity_mae.toFixed(4)} m/s，跌倒率 ${result.fall_rate*100}%，${result.steps} 步。`;el('play').textContent='运行仿真';}finally{busy=false;showJob(currentJob);}});
action('apply',async()=>{const active=await request('apply',{id:selected,evaluation});displayActive(active);notice('已应用候选策略；桌宠普通脚行走将使用新策略。');});
action('rollback',async()=>{displayActive(await request('rollback'));notice('已恢复上一策略。');});
action('export',async()=>{const result=await request('export',{id:selected});if(result.url){const link=document.createElement('a');link.href=result.url;link.download=`${selected}.onnx`;link.click();}else if(!result.cancelled)notice(`已导出：${result.path}`);});
try{
  const bootstrap=await request('bootstrap');const d=bootstrap.defaults;
  el('reward').value=d.reward;el('strategy').value=d.strategy;el('python').value=d.pythonPath;displayActive(bootstrap.active);
  for(const [id,key] of Object.entries({'training-device':'training_device','inference-device':'inference_device',iterations:'iterations',environments:'environments','rollout-steps':'rollout_steps','target-speed':'target_speed','learning-rate':'learning_rate',seed:'seed'}))el(id).value=d[key];
  el('train').disabled=false;await refresh();
  runtime=await createDuckRuntime({container:el('lab-stage'),policyUrl,mode:'lab',quality:{fps:60,shadows:true,pixelRatio:1.5}});
  for(const id of ['play','step','reset'])el(id).disabled=false;
  el('runtime-status').textContent='仿真就绪 · CPU / WASM';
  el('joints').replaceChildren(...runtime.labSnapshot().joints.map(j=>{const label=document.createElement('label');const text=document.createElement('div');text.className='joint-label';const name=document.createElement('span');name.textContent=j.name;const value=document.createElement('output');value.textContent=j.position.toFixed(3);value.dataset.joint=j.name;text.append(name,value);const slider=document.createElement('input');slider.type='range';slider.min=j.range[0];slider.max=j.range[1];slider.step='0.01';slider.value=j.position;slider.setAttribute('aria-label',j.name);slider.addEventListener('input',()=>{value.textContent=Number(slider.value).toFixed(3);runtime.labControl('joint',{name:j.name,position:Number(slider.value)}).catch(error=>notice(error.message,true));el('play').textContent='运行仿真';});label.append(text,slider);return label;}));
}catch(error){el('runtime-status').textContent='加载失败';notice(error.message,true);console.error(error);}
const poll=setInterval(refresh,1000);
const telemetry=setInterval(()=>{if(!runtime)return;const s=runtime.labSnapshot();el('play').textContent=s.paused?'运行仿真':'暂停仿真';for(const j of s.joints){const output=el('joints').querySelector(`output[data-joint="${j.name}"]`);if(output)output.textContent=j.position.toFixed(3)+' rad';}el('telemetry').textContent=`t ${s.time.toFixed(2)} s\nv ${s.velocity.toFixed(3)} m/s\nz ${s.position[2].toFixed(3)} m\n${s.paused?'PAUSED':'RUNNING'}`;},150);
window.addEventListener('beforeunload',()=>{closed=true;clearInterval(poll);clearInterval(telemetry);clearTimeout(noticeTimer);runtime?.dispose();},{once:true});
