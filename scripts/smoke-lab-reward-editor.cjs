'use strict';
// Real virtual UI + IPC reward editing; capture submissions without starting training or App main.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-reward-smoke-')),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/reward-editor/source');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(tmp,'profile'));const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),scope:'real virtual UI and IPC, training start intercepted before execution, no hardware'};
 try{
  policies.installHandler(protocol,net,pathToFileURL);
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:path.join(tmp,'jobs')});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>({...jobs,start:payload=>{report.submitted=payload;throw Error('QA: captured reward, no training started');}})});lab.open();
  const wc=lab.getWindow().webContents,run=s=>wc.executeJavaScript(s);
  const until=async fn=>{const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Laboratory timed out');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  await run("document.getElementById('training-tab').click();true");
  const changeTask=async task=>{
   await run(`document.getElementById('training-task').value=${JSON.stringify(task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
   await until(()=>run("!document.getElementById('training-task').disabled"));
   await run("document.querySelector('[data-lesson=\"1\"]').click();true");
  };
  await changeTask('microduck-headstand-hold');
  report.editor=await run("({visible:document.getElementById('reward').checkVisibility(),script:document.getElementById('reward').value})");
  fs.writeFileSync(path.join(output,'reward-initial.png'),(await wc.capturePage()).toPNG());
  assert.equal(report.editor.visible,true,'Custom reward editor must be visible immediately in step 2');
  assert.equal(report.editor.script,jobs.holdDefaults().reward,'Displayed reward must match the actual action template');
  const edited=report.editor.script.replace('hold = 2.0', 'hold = 2.5')+'\n# custom reward UI regression\n';
  await run(`document.getElementById('reward').value=${JSON.stringify(edited)};document.getElementById('reward').dispatchEvent(new Event('input'));true`);
  await changeTask('microduck-flat-walk');
  assert.equal(await run("document.getElementById('reward').value"),jobs.defaults().reward,'Action draft must not overwrite walking reward');
  await changeTask('microduck-headstand-hold');
  assert.equal(await run("document.getElementById('reward').value"),edited,'Custom action reward survives switching lessons');
  await run("document.querySelector('[data-lesson=\"2\"]').click();document.getElementById('edit-reward').click();true");
  assert.ok(await run("document.getElementById('reward').checkVisibility() && document.activeElement.id==='reward'"),'Training step shortcut opens and focuses the actual editor');
  await run("document.querySelector('[data-lesson=\"2\"]').click();document.getElementById('train').click();true");
  await until(()=>Boolean(report.submitted));
  assert.equal(report.submitted.task,'microduck-headstand-hold');assert.equal(Object.hasOwn(report.submitted,'action_name'),false,'Hidden action name must not override the headstand task name');assert.equal(report.submitted.reward,edited,'Actual IPC training submission must use edited reward');
  assert.equal(jobs.list().length,0);report.jobsStarted=0;
  delete report.submitted;delete report.editor.script;
  await run("document.querySelector('[data-lesson=\"1\"]').click();scrollTo(0,0);true");
  await run(`document.getElementById('reward').value=${JSON.stringify(jobs.holdDefaults().reward)};document.getElementById('notice').hidden=true;true`);
  report.layouts=[];
  for(const [width,height] of [[1440,960],[1000,700]]){
   lab.getWindow().setContentSize(width,height);await wait(150);
   assert.ok(await run("document.documentElement.scrollWidth<=innerWidth"),'No horizontal overflow');
   fs.writeFileSync(path.join(output,`reward-${width}.png`),(await wc.capturePage()).toPNG());report.layouts.push({width,height});
  }
  lab.getWindow().setContentSize(1440,960);
  await run("document.querySelector('.action-reward-guide:not([hidden])').open=true;document.querySelector('.action-reward-guide:not([hidden])').scrollIntoView({block:'start'});true");await wait(150);
  fs.writeFileSync(path.join(output,'reward-guide.png'),(await wc.capturePage()).toPNG());
  report.draftsIsolated=true;report.customRewardSubmitted=true;
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
