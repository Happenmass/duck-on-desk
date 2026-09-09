'use strict';
// Virtual-only lesson and real MPS preview smoke test. Never starts src/main.js or hardware.
// Run after build:renderer with node_modules/.bin/electron scripts/smoke-lab-learning.cjs.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-learning-smoke-'));
const weightRoot=path.join(os.homedir(),'.cache/huggingface/microduck-robot-lab');fs.mkdirSync(weightRoot,{recursive:true});
const weights=fs.mkdtempSync(path.join(weightRoot,'preview-qa-'));
app.setPath('userData',path.join(tmp,'profile'));
const policies=require('../src/robots/duck/pet-model-protocol');policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,description,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Timed out: '+description);}
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),scope:'isolated virtual lab, real MPS PPO, no installed app or hardware',errors:[],runs:[]};
 try{
  let saved={};try{saved=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.duck-on-desk/robot-lab/workbench.json'),'utf8'));}catch{}
  const pythonPath=process.env.DUCK_LAB_PYTHON||saved.pythonPath;assert.ok(pythonPath,'Set DUCK_LAB_PYTHON to a prepared training Python');
  jobs=require('../mcp/robot-lab/jobs.cjs').createLabJobs({root:path.join(tmp,'lab'),weights});
  fs.mkdirSync(path.join(tmp,'lab'),{recursive:true});fs.writeFileSync(path.join(tmp,'lab/workbench.json'),JSON.stringify({...jobs.defaults(),pythonPath,target_speed:.15,iterations:20,environments:4,rollout_steps:32,learning_rate:.0003,seed:0,training_device:'mps',inference_device:'mps'}));
  policies.installHandler(protocol,net,pathToFileURL,{resolveLabPolicy:id=>jobs.artifact(id)});
  lab=require('../src/shell/robot-lab-window').createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const window=lab.getWindow(),wc=window.webContents,run=s=>wc.executeJavaScript(s);
  wc.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('THREE.WebGLRenderer: Context Lost'))report.errors.push(event.message);});
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'),'lab ready');
  window.setContentSize(1440,1000);
  await run(`document.getElementById('training-tab').click();true`);await wait(200);
  const screenshot=async name=>{await wait(150);fs.mkdirSync(path.join(root,'.release-reviews'),{recursive:true});fs.writeFileSync(path.join(root,'.release-reviews',name),(await wc.capturePage()).toPNG());};
  const canvas=()=>run(`document.querySelectorAll('#preview-stage canvas').length`);
  assert.equal(await canvas(),0,'Preview is off by default');
  assert.equal(await run(`document.getElementById('live-preview-toggle').getAttribute('aria-pressed')`),'false');
  await screenshot('lab-lesson-task.png');
  await run(`document.querySelector('[data-quiz="no"]').click();document.querySelector('[data-concept="learning"]').click();true`);
  assert.ok(await run(`document.getElementById('quiz-feedback').textContent.includes('原地站着')`));
  const oldReward=await run(`document.getElementById('reward').value`);
  await run(`document.querySelector('[data-lesson="1"]').click();document.getElementById('reward-speed').value='1.2';document.getElementById('reward-speed').dispatchEvent(new Event('input'));true`);
  assert.equal(await run(`document.getElementById('reward').value`),oldReward,'Draft sliders must not silently overwrite code');
  await run(`document.getElementById('use-reward').click();true`);
  assert.ok(await run(`document.getElementById('reward').value.includes('1.2 * tracking')`));
  await screenshot('lab-lesson-reward.png');
  // Use the lesson-generated default reward in all real runs, so this also validates the builder.
  await run(`document.getElementById('reward-speed').value='1';document.getElementById('use-reward').click();document.querySelector('[data-lesson="2"]').click();true`);
  async function setPreview(on){const value=await run(`document.getElementById('live-preview-toggle').getAttribute('aria-pressed')`);if((value==='true')!==on)await run(`document.getElementById('live-preview-toggle').click();true`);await until(async()=>await canvas()===(on?1:0),'preview canvas toggle');await wait(300);}
  async function start(iterations){const count=jobs.list().length;await run(`document.getElementById('iterations').value='${iterations}';document.getElementById('train').click();true`);await until(()=>jobs.list().length>count,'training starts');return jobs.list()[0].id;}
  async function complete(id){await until(()=>['completed','failed','cancelled'].includes(jobs.get(id).phase),'training completes');const job=jobs.get(id);assert.equal(job.phase,'completed',job.error);await until(()=>run(`document.getElementById('train').disabled===false`),'UI reflects completion');return job;}
  // Warm the process-independent file/GPU caches; exclude this run from timings.
  const warm=await complete(await start(5));report.warmup={id:warm.id,seconds:warm.metrics.at(-1).elapsed_seconds};
  for(const on of [false,true,true,false]){
    await setPreview(on);const began=Date.now(),id=await start(40),job=await complete(id);
    const m=job.manifest;
    report.runs.push({id,preview:on,seconds:job.metrics.at(-1).elapsed_seconds,wall_seconds:(Date.now()-began)/1000,frames:m.preview_frames,write_seconds:m.preview_write_seconds,policy_sha256:m.policy_sha256,steps:m.environment_steps,metrics:job.metrics,baseline:m.baseline,candidate:m.candidate});
    assert.equal(m.environment_steps,5120);assert.ok(on?m.preview_frames>5:m.preview_frames===0);
    if(on)assert.ok(Number(await run(`document.getElementById('preview-stage').dataset.renderedSequence`))>1,'Real poses reach the rendered canvas');
    console.log(JSON.stringify({preview:on,seconds:job.metrics.at(-1).elapsed_seconds,frames:m.preview_frames}));
  }
  const series=j=>j.metrics.map(({iteration,mean_reward,policy_loss,value_loss})=>({iteration,mean_reward,policy_loss,value_loss}));
  report.identical_metrics=report.runs.every(r=>JSON.stringify(series(r))===JSON.stringify(series(report.runs[0])));
  report.identical_policy=report.runs.every(r=>r.policy_sha256===report.runs[0].policy_sha256);
  const avg=on=>{const a=report.runs.filter(r=>r.preview===on);return a.reduce((s,r)=>s+r.seconds,0)/a.length;};
  report.timing={off_mean:avg(false),on_mean:avg(true),difference_percent:(avg(true)/avg(false)-1)*100};
  // A separate live run covers interruption, visibility and screenshots without biasing timings.
  await setPreview(true);const active=await start(120);
  const frameFile=path.join(tmp,'lab/jobs',active+'.live.json'),watchFile=path.join(tmp,'lab/jobs',active+'.preview-watch.json');
  const readFrame=()=>{try{return JSON.parse(fs.readFileSync(frameFile,'utf8'));}catch{return null;}};
  await until(()=>jobs.get(active).metrics.length>=5&&readFrame()?.iteration>=2,'live poses and metrics');
  const a=readFrame();await wait(350);const b=readFrame();
  assert.ok(b.sequence>a.sequence);assert.notDeepEqual(a.joints,b.joints,'Live preview must contain changing real joint poses');
  await screenshot('lab-lesson-preview.png');
  await setPreview(false);await wait(800);const stopped=readFrame().sequence,metricsBefore=jobs.get(active).metrics.length;
  assert.equal(fs.existsSync(watchFile),false);await wait(700);
  assert.equal(readFrame().sequence,stopped,'Pose transmission stops when preview is disabled');
  assert.ok(jobs.get(active).metrics.length>metricsBefore,'Training continues while preview is off');
  report.toggle={first_sequence:a.sequence,later_sequence:b.sequence,stopped_sequence:stopped,metrics_before:metricsBefore,metrics_after:jobs.get(active).metrics.length};
  await setPreview(true);await until(()=>readFrame().sequence>stopped,'preview resumes');
  await run(`document.getElementById('control-tab').click();true`);await until(async()=>await canvas()===0,'hidden preview disposed');await wait(800);assert.equal(fs.existsSync(watchFile),false);
  const hiddenSequence=readFrame().sequence;await wait(600);assert.equal(readFrame().sequence,hiddenSequence);
  await run(`document.getElementById('training-tab').click();true`);await until(async()=>await canvas()===1&&readFrame().sequence>hiddenSequence,'visible preview resumes');
  jobs.cancel(active);await until(()=>jobs.get(active).phase==='cancelled','cancel smoke run');await wait(1100);
  await setPreview(false);assert.ok(await run(`document.getElementById('evaluation').textContent.includes('这次练习已停止')`),'A stopped run must not show the previous run’s successful evaluation');
  const completedId=report.runs[0].id;
  await run(`document.getElementById('runs').value='${completedId}';document.getElementById('runs').dispatchEvent(new Event('change'));document.querySelector('[data-lesson="3"]').click();true`);await wait(300);await screenshot('lab-lesson-results.png');
  await run(`document.querySelector('.loss-details').open=true;document.querySelector('.loss-details').scrollIntoView({block:'end'});true`);await screenshot('lab-lesson-loss.png');
  assert.equal(await run(`document.querySelectorAll('.loss-details .curve-line').length`),2);
  await run(`document.querySelector('.loss-details').open=false;scrollTo(0,0);true`);
  report.layouts=[];
  for(const [width,height] of [[1440,1000],[1280,800],[1000,700]]){
    window.setContentSize(width,height);await wait(300);
    const layout=await run(`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})`);assert.equal(layout.overflow,false);report.layouts.push(layout);
  }
  await run(`document.querySelector('[data-lesson="2"]').click();true`);await screenshot('lab-lesson-compact.png');
  assert.deepEqual(report.errors,[]);report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{
  try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');await wait(200);}catch{}
  lab?.dispose();jobs?.dispose();fs.writeFileSync('/tmp/duck-learning-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:report.ok,error:report.error,timing:report.timing,identical_metrics:report.identical_metrics,identical_policy:report.identical_policy}));
  fs.rmSync(tmp,{recursive:true,force:true});fs.rmSync(weights,{recursive:true,force:true});app.exit(report.ok?0:1);
 }
});
