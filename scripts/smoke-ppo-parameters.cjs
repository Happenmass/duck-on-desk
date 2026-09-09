'use strict';
// Isolated virtual lab; never loads src/main.js or contacts a physical robot.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo;
const labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/ppo-parameters/ui');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-ppo-ui-'));app.setPath('userData',path.join(temp,'profile'));
const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
app.whenReady().then(async()=>{
 let lab,jobs;const report={errors:[]};
 try{
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:process.env.DUCK_SMOKE_RECORDS||path.join(temp,'lab')});
  policies.installHandler(protocol,net,pathToFileURL,{resolveLabPolicy:id=>jobs.artifact(id)});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const win=lab.getWindow(),wc=win.webContents,run=code=>wc.executeJavaScript(code);win.setContentSize(1400,1000);
  wc.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  const until=async fn=>{for(let i=0;i<900;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('UI timeout');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  await run(`document.getElementById('training-tab').click();document.querySelector('[data-lesson="2"]').click();document.getElementById('training-environment').open=true;true`);
  assert.equal(await run("document.getElementById('ppo-profile').value"),'local-ppo-v2');
  assert.equal(await run("document.getElementById('environments').value"),String(jobs.defaults().environments));
  await run(`document.getElementById('training-task').value='microduck-headstand-hold';document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
  await until(()=>run("!document.getElementById('training-task').disabled"));
  assert.equal(await run("document.getElementById('policy-initialization').value"),'random');
  assert.equal(await run("document.getElementById('learning-rate').value"),'0.0003');
  assert.equal(await run("document.getElementById('environments').value"),'32');
  assert.equal(await run("document.getElementById('reset-seconds').value"),'30');
  assert.equal(jobs.holdDefaults().hold_episode_steps,1500);
  await run(`document.getElementById('reset-seconds').value=45;document.getElementById('reset-seconds').dispatchEvent(new Event('input'));true`);
  assert.match(await run("document.getElementById('sampling-summary').textContent"),/每 45 秒/);
  for(const task of ['microduck-flat-walk','microduck-headstand-hold']){
   await run(`document.getElementById('training-task').value=${JSON.stringify(task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
   await until(()=>run("!document.getElementById('training-task').disabled"));
  }
  assert.equal(await run("document.getElementById('reset-seconds').value"),'45');
  if(process.env.DUCK_SMOKE_TEST_RESET_START){
   await run(`document.getElementById('iterations').value=1;document.getElementById('environments').value=1;document.getElementById('rollout-steps').value=8;document.getElementById('train').click();true`);
   await until(async()=>jobs.list().some(j=>j.phase==='completed'||j.phase==='failed'));
   const job=jobs.list()[0];assert.equal(job.phase,'completed',job.error);
   assert.equal(job.settings.hold_episode_steps,2250);report.customResetJob=job.id;
   await run(`document.getElementById('environments').value=32;document.getElementById('rollout-steps').value=64;true`);
  }
  await run(`document.getElementById('reset-seconds').value=0;document.getElementById('reset-seconds').dispatchEvent(new Event('input'));true`);
  assert.match(await run("document.getElementById('sampling-summary').textContent"),/不按时间重置/);
  await run(`document.getElementById('reset-seconds').value=30;document.getElementById('reset-seconds').dispatchEvent(new Event('input'));true`);
  const reward=await run("document.getElementById('reward').value");
  assert.doesNotMatch(reward,/0\.25 \* s\['feet_contact'\]/);
  assert.equal(jobs.holdDefaults().reset_on_pose_loss,false);
  assert.match(await run("document.querySelector('[data-lesson-page=\"0\"] .lesson-copy').textContent"),/允许用脚蹬地找回平衡/);
  await run(`document.getElementById('environments').value=16;document.getElementById('environments').dispatchEvent(new Event('input'));true`);
  assert.match(await run("document.getElementById('sampling-summary').textContent"),/1,024/);
  await run(`document.getElementById('recommended-training').click();true`);
  assert.equal(await run("document.getElementById('reward').value"),reward);
  assert.match(await run("document.getElementById('sampling-summary').textContent"),/2,048/);
  await run(`document.querySelector('[data-lesson="2"]').click();document.getElementById('training-environment').open=true;document.getElementById('training-environment').scrollIntoView({block:'start'});true`);
  assert.equal(await run("document.querySelector('[data-lesson-page=\"2\"]').hidden"),false);
  await new Promise(resolve=>setTimeout(resolve,400));
  if(process.env.DUCK_SMOKE_TEST_ENVIRONMENT){
   const count=jobs.list().length;
   await run(`document.getElementById('python').value='definitely-missing-duck-python';document.getElementById('setup-environment').click();true`);
   await until(()=>run(`!document.getElementById('setup-environment').disabled && document.getElementById('environment-status').textContent.includes('自定义 Python 环境检查失败')`));
   await run(`document.getElementById('python').value='';document.getElementById('setup-environment').click();true`);
   await until(()=>run(`!document.getElementById('setup-environment').disabled && document.getElementById('environment-status').textContent.includes('训练环境与模型已就绪')`));
   assert.equal(jobs.list().length,count);report.environmentRetry=true;
  }
  report.summary=await run("document.getElementById('sampling-summary').textContent");
  fs.writeFileSync(path.join(output,'parameters.png'),(await wc.capturePage()).toPNG());
  if(process.env.DUCK_SMOKE_RUN_ID){
   const id=process.env.DUCK_SMOKE_RUN_ID;
   await run(`document.getElementById('runs').value=${JSON.stringify(id)};document.getElementById('runs').dispatchEvent(new Event('change'));true`);
   await until(()=>run("!document.getElementById('evaluate').disabled"));
   await run(`document.querySelector('[data-lesson="3"]').click();document.getElementById('evaluate').click();true`);
   await until(()=>run("!document.getElementById('evaluate').disabled&&!document.getElementById('evaluation').textContent.includes('正在')"));
   report.evaluation=await run("document.getElementById('evaluation').textContent");
   assert.match(report.evaluation,/近倒立初态测试/);
   if(process.env.DUCK_SMOKE_CAPTURE_RESULT){
    await run(`document.getElementById('preview').click();true`);
    await new Promise(resolve=>setTimeout(resolve,10000));
    await until(()=>run("document.getElementById('play').textContent==='运行仿真'"));
    await run(`document.querySelector('[data-camera="side"]').click();document.getElementById('hologram').click();document.getElementById('control-deck').scrollIntoView({block:'start'});true`);
    await new Promise(resolve=>setTimeout(resolve,400));
    report.previewTelemetry=await run("document.getElementById('telemetry').textContent");
    fs.writeFileSync(path.join(output,'evaluation-pose.png'),(await wc.capturePage()).toPNG());
   }
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
 }catch(error){report.error=error.stack;report.ok=false;}
 finally{lab?.dispose();jobs?.dispose();fs.rmSync(temp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
