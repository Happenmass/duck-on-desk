'use strict';
// Isolated virtual-only integration harness. Never loads src/main.js, hardware adapters,
// agent hooks or the user's Electron profile. Uses existing cached training artifacts.
const {app,BrowserWindow,ipcMain,protocol,net,dialog}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-virtual-lab-'));
app.setPath('userData',path.join(tmp,'electron-profile'));
const policies=require('../src/robots/duck/pet-model-protocol');policies.registerScheme(protocol);
const {createLabJobs}=require('../mcp/robot-lab/jobs.cjs');
const source=createLabJobs();
const evaluation=JSON.parse(fs.readFileSync(path.join(root,'docs/diagnostics/robot-lab-mcp-2026-09-08/browser-evaluation.json'),'utf8')).evaluation;
const run=evaluation.runId;
const sourceRoot=process.env.DUCK_LAB_HOME||path.join(os.homedir(),'.duck-on-desk/robot-lab');
fs.mkdirSync(path.join(tmp,'lab/jobs'),{recursive:true});
fs.copyFileSync(path.join(sourceRoot,'jobs',run+'.json'),path.join(tmp,'lab/jobs',run+'.json'));
const jobs=createLabJobs({root:path.join(tmp,'lab')});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await wait(100);}throw new Error('Timed out waiting for virtual renderer');}
const report={timestamp:new Date().toISOString(),scope:'isolated virtual renderers; no app main, hardware, hooks or user profile',errors:[]};
let pet,lab;
app.whenReady().then(async()=>{
  try {
    policies.installHandler(protocol,net,pathToFileURL,{resolveLabPolicy:id=>jobs.artifact(id)});
    ipcMain.handle('pet-runtime-config',()=>({petRobot:'duck',duckMuted:true,duckLocomotion:'legs',duckStilts:0}));
    pet=new BrowserWindow({width:320,height:320,show:false,webPreferences:{preload:path.join(root,'src/preload.js'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    pet.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await pet.loadFile(path.join(root,'renderer-dist/index.html'));
    await until(()=>pet.webContents.executeJavaScript('Boolean(window.__duckRuntime?.snapshot().ready)'));
    await pet.webContents.executeJavaScript(`window.__labLoads=[];const original=window.__duckRuntime.setLabPolicy.bind(window.__duckRuntime);window.__duckRuntime.setLabPolicy=async url=>{await original(url);window.__labLoads.push(url);};true;`);
    lab=require('../src/shell/robot-lab-window').createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{...dialog,showSaveDialog:async()=>({filePath:path.join(tmp,'export.onnx')})},getJobs:()=>jobs,onApply:url=>pet.webContents.send('duck-walk-policy-change',url)});
    lab.open();const first=lab.getWindow();
    first.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
    await until(()=>first.webContents.executeJavaScript('document.getElementById("runtime-status").textContent.includes("仿真就绪")'));
    report.lab_ready=true;
    const active=await first.webContents.executeJavaScript(`window.robotLabAPI.request('apply',${JSON.stringify({id:run,evaluation})})`);
    assert.equal(active.current,run);
    await until(()=>pet.webContents.executeJavaScript('window.__labLoads.length===1'));
    report.applied=await pet.webContents.executeJavaScript('window.__labLoads[0]');
    await pet.webContents.executeJavaScript(`window.__duckRuntime.command({type:'move',source:'local',forward:0.15,ttlMs:1000});`);
    await wait(1200);
    report.pet_running=await pet.webContents.executeJavaScript('window.__duckRuntime.snapshot()');
    assert.ok(report.pet_running.ready&&Number.isFinite(report.pet_running.height));
    const exported=await first.webContents.executeJavaScript(`window.robotLabAPI.request('export',{id:${JSON.stringify(run)}})`);
    assert.ok(fs.existsSync(exported.path));assert.ok(fs.existsSync(exported.path+'.manifest.json'));
    report.export_bytes=fs.statSync(exported.path).size;
    await first.webContents.executeJavaScript(`window.robotLabAPI.request('rollback')`);
    await until(()=>pet.webContents.executeJavaScript('window.__labLoads.length===2'));
    assert.equal(await pet.webContents.executeJavaScript('window.__labLoads[1]'),null);report.rollback=true;
    first.destroy();assert.equal(lab.getWindow(),null);lab.open();
    await until(()=>lab.getWindow().webContents.executeJavaScript('document.getElementById("runtime-status").textContent.includes("仿真就绪")'));
    report.reopened=true;assert.deepEqual(report.errors,[]);
    report.ok=true;
  }catch(error){report.ok=false;report.error=error.stack;process.exitCode=1;}
  finally{
    lab?.dispose();pet?.destroy();jobs.dispose();source.dispose();
    fs.writeFileSync(path.join(root,'docs/diagnostics/robot-lab-mcp-2026-09-08/electron-integration.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));fs.rmSync(tmp,{recursive:true,force:true});app.exit(report.ok?0:1);
  }
});
