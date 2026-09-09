'use strict';
// Virtual UI + IPC validation only; never start a long training job or App main.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-limit-smoke-')),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/unrestricted-training/ipc');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(tmp,'profile'));const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),lessons:[],scope:'real virtual UI and IPC, no long training or hardware'};
 try{
  policies.installHandler(protocol,net,pathToFileURL);
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:path.join(tmp,'jobs'),prepare:()=>new Promise(()=>{})});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const wc=lab.getWindow().webContents,run=s=>wc.executeJavaScript(s);
  const until=async fn=>{const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Laboratory timed out');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  await run("document.getElementById('training-tab').click();document.querySelector('[data-lesson=\"2\"]').click();true");
  for(const task of ['microduck-flat-walk','microduck-headstand-hold']){
   if(task!=='microduck-flat-walk'){
    await run(`document.getElementById('training-task').value=${JSON.stringify(task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
    await until(()=>run("!document.getElementById('training-task').disabled"));
   }
   const result=await run("(()=>{const input=document.getElementById('iterations');const initial=input.value;input.value='100000';const accepts=input.checkValidity();input.value='0';const rejects=!input.checkValidity();input.value='100000';return {initial,max:input.max,accepts,rejects,hint:input.parentElement.textContent};})()");
   assert.equal(result.initial,'200');assert.equal(result.max,'');assert.equal(result.accepts,true);assert.equal(result.rejects,true);assert.doesNotMatch(result.hint,/最多|2 小时/);
   const invalid=await run(`window.robotLabAPI.request('start',{task:${JSON.stringify(task)},iterations:0})`);assert.match(invalid.error,/Invalid iterations/);
   const queued=await run(`window.robotLabAPI.request('start',{task:${JSON.stringify(task)},iterations:100000,environments:4096,rollout_steps:1024,hold_episode_steps:100000,learning_rate:.1,seed:4294967296})`);
   assert.ok(!queued.error,JSON.stringify(queued));
   const job=jobs.list()[0];assert.equal(job.settings.iterations,100000);assert.equal(job.settings.environments,4096);assert.equal(job.settings.rollout_steps,1024);
   await run(`window.robotLabAPI.request('cancel',{id:${JSON.stringify(job.id)}})`);
   assert.equal(jobs.get(job.id).phase,'cancelled');
   report.lessons.push({task,...result,ipcError:invalid.error});
  }
  assert.equal(jobs.list().length,2);report.queuedAndCancelled=2;report.trainingProcessesStarted=0;
  await run("document.querySelector('[data-lesson=\"2\"]').click();true");
  fs.writeFileSync(path.join(output,'training-limit.png'),(await wc.capturePage()).toPNG());report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
