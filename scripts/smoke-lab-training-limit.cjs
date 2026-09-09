'use strict';
// Virtual UI + IPC validation only; never start a long training job or App main.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-limit-smoke-')),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/training-2000/source');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(tmp,'profile'));const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),lessons:[],scope:'real virtual UI and IPC, no long training or hardware'};
 try{
  policies.installHandler(protocol,net,pathToFileURL);
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:path.join(tmp,'jobs')});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const wc=lab.getWindow().webContents,run=s=>wc.executeJavaScript(s);
  const until=async fn=>{const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Laboratory timed out');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  await run("document.getElementById('training-tab').click();document.querySelector('[data-lesson=\"2\"]').click();true");
  for(const task of ['microduck-flat-walk','microduck-headstand-hold','microduck-headstand']){
   if(task!=='microduck-flat-walk'){
    await run(`document.getElementById('training-task').value=${JSON.stringify(task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
    await until(()=>run("!document.getElementById('training-task').disabled"));
   }
   const result=await run("(()=>{const input=document.getElementById('iterations');const initial=input.value;input.value='2000';const accepts=input.checkValidity();input.value='2001';const rejects=!input.checkValidity();input.value='2000';return {initial,max:input.max,accepts,rejects,hint:input.parentElement.textContent};})()");
   assert.equal(result.initial,'200');assert.equal(result.max,'2000');assert.equal(result.accepts,true);assert.equal(result.rejects,true);assert.match(result.hint,/2 小时/);
   const invalid=await run(`window.robotLabAPI.request('start',{task:${JSON.stringify(task)},iterations:2001})`);assert.match(invalid.error,/Invalid iterations: 1..2000/);
   report.lessons.push({task,...result,ipcError:invalid.error});
  }
  assert.equal(jobs.list().length,0);report.jobsStarted=0;
  await run("document.querySelector('[data-lesson=\"2\"]').click();true");
  fs.writeFileSync(path.join(output,'training-limit.png'),(await wc.capturePage()).toPNG());report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
