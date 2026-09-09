'use strict';
// Real virtual-lab camera regression; never loads the App main or hardware.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-camera-smoke-')),output=path.resolve(process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/camera-follow'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(tmp,'profile'));
const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Timed out waiting for laboratory');}
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),scope:'real ONNX/MuJoCo virtual laboratory; no hardware',samples:[]};
 try{
  policies.installHandler(protocol,net,pathToFileURL);
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:path.join(tmp,'jobs')});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const win=lab.getWindow(),wc=win.webContents,run=s=>wc.executeJavaScript(s);win.setContentSize(1440,960);
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  const snapshot=()=>run(`({telemetry:document.getElementById('telemetry').textContent,visible:document.querySelectorAll('.joint-pin:not([hidden])').length,pins:[...document.querySelectorAll('.joint-pin')].map(p=>({joint:p.dataset.joint,visible:!p.hidden,x:parseFloat(p.style.left),y:parseFloat(p.style.top)}))})`);
  await wait(200);report.before=await snapshot();
  await run(`document.getElementById('forward').value='.25';document.getElementById('turn').value='0';document.getElementById('play').click();true`);
  for(let i=0;i<10;i++){await wait(1000);report.samples.push(await snapshot());}
  await run(`document.getElementById('play').click();true`);await wait(200);
  report.after=await snapshot();fs.writeFileSync(path.join(output,'after-walking.png'),(await wc.capturePage()).toPNG());
  assert.ok(parseFloat(report.after.telemetry)>=8,'Simulation must actually advance');
  assert.ok(report.samples.every(s=>s.visible>=12),'Walking must keep at least 12 joint markers in view');
  await run(`document.getElementById('reset').click();true`);await wait(300);report.reset=await snapshot();assert.equal(report.reset.visible,14);
  // Follow must continue after a user rotates and zooms the orbit camera.
  const box=await run(`(()=>{const r=document.querySelector('#lab-stage canvas').getBoundingClientRect();return{x:r.x+r.width*.55,y:r.y+r.height*.45}})()`),x=Math.round(box.x),y=Math.round(box.y);
  wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});wc.sendInputEvent({type:'mouseMove',button:'left',x:x+60,y:y+15});wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x+60,y:y+15});
  wc.sendInputEvent({type:'mouseWheel',x,y,deltaY:-30,deltaX:0});await wait(250);
  await run(`document.getElementById('play').click();true`);await wait(6000);await run(`document.getElementById('play').click();true`);await wait(200);
  report.orbitWalk=await snapshot();assert.ok(report.orbitWalk.visible>=12);
  for(const view of ['front','side','top']){await run(`document.querySelector('[data-camera="${view}"]').click();true`);await wait(200);assert.equal((await snapshot()).visible,14,view);}
  await run(`document.getElementById('camera-home').click();true`);await wait(200);assert.equal((await snapshot()).visible,14);
  report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,error:report.error,before:report.before?.visible,after:report.after?.visible}));app.exit(report.ok?0:1);}
});
