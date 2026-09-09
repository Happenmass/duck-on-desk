'use strict';
// Only a virtual renderer. Never load src/main.js or physical robot adapters.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-actions-smoke-')),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/duck-actions/pet');
app.setPath('userData',path.join(tmp,'profile'));fs.mkdirSync(output,{recursive:true});
const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const report={time:new Date().toISOString(),samples:[],errors:[]};let win;
 try {
  policies.installHandler(protocol,net,pathToFileURL);
  ipcMain.handle('pet-runtime-config',()=>({petRobot:'duck',duckMuted:true,duckRandomActions:false}));
  win=new BrowserWindow({width:500,height:500,show:true,webPreferences:{preload:path.join(root,'src/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  await win.loadFile(path.join(root,'renderer-dist/index.html'));
  const run=code=>win.webContents.executeJavaScript(code);
  const until=async(fn,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Virtual action timed out');};
  await until(()=>run('window.__duckRuntime?.snapshot().ready'),45000);
  win.webContents.send('state-change',{file:'duck-working'});await wait(3000);
  await run("window.__duckRuntime.playAction('peck');true");
  const start=Date.now();let seen=false;
  while(Date.now()-start<13000){
   const s=await run('window.__duckRuntime.snapshot()');report.samples.push(s);
   if(s.action)seen=true;else if(seen)break;await wait(100);
  }
  const phases=[...new Set(report.samples.map(s=>s.action?.phase).filter(Boolean))];
  assert.deepEqual(phases,['settling','playing','returning']);assert.equal(report.samples.at(-1).action,null);
  assert.ok(report.samples.at(-1).forward>0,'live walking lease must resume');
  await wait(2000);report.resumed=await run('window.__duckRuntime.snapshot()');
  assert.equal(report.resumed.mode,'walk');assert.ok(report.resumed.forward>0);assert.equal(report.resumed.busy,false);
  // Exercise the real random adapter and preload preference event on a live walker.
  const randomStart=Date.now();win.webContents.send('duck-random-actions-change',true);
  report.randomWait=[];
  await until(async()=>{const s=await run('window.__duckRuntime.snapshot()');if(!report.randomWait.length||Date.now()-randomStart-report.randomWait.at(-1).elapsedMs>=1000)report.randomWait.push({elapsedMs:Date.now()-randomStart,...s});return s.action?.phase==='playing';},65000);
  report.random={elapsedMs:Date.now()-randomStart,snapshot:await run('window.__duckRuntime.snapshot()')};
  assert.ok(report.random.elapsedMs>=25000);assert.equal(report.random.snapshot.action.id,'peck');
  win.webContents.send('duck-random-actions-change',false);
  await until(()=>run('window.__duckRuntime.snapshot().action===null'));
  await run("window.__duckRuntime.playAction('peck');true");await until(()=>run("window.__duckRuntime.snapshot().action?.phase==='playing'"));
  win.webContents.send('state-change',{file:'duck-sleeping'});await wait(3200);
  report.sleep=await run('window.__duckRuntime.snapshot()');assert.equal(report.sleep.action,null);assert.equal(report.sleep.sleeping,true);assert.equal(report.sleep.forward,0);
  win.webContents.send('state-change',{file:'duck-working'});await wait(2500);
  await run("window.__duckRuntime.playAction('peck');true");await wait(200);
  await run("window.__duckRuntime.command({type:'grab-start'});true");
  report.grab=await run('window.__duckRuntime.snapshot()');assert.equal(report.grab.action,null);assert.equal(report.grab.grabbed,true);assert.equal(report.grab.forward,0);
  fs.writeFileSync(path.join(output,'pet.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(report.errors,[]);report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await win?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}win?.destroy();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,error:report.error,phases:[...new Set(report.samples.map(s=>s.action?.phase))],errors:report.errors}));app.exit(report.ok?0:1);}
});
