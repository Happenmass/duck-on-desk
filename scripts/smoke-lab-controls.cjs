'use strict';
// Virtual-only UI regression: does a slider visibly move its joint without another click?
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-control-smoke-'));
app.setPath('userData',path.join(tmp,'profile'));
const policies=require('../src/robots/duck/pet-model-protocol');policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){let end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Lab did not become ready');}
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),scope:'virtual-only, no main application or hardware'};
 try{
  policies.installHandler(protocol,net,pathToFileURL);
  jobs=require('../mcp/robot-lab/jobs.cjs').createLabJobs({root:path.join(tmp,'jobs')});
  lab=require('../src/shell/robot-lab-window').createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const wc=lab.getWindow().webContents;const run=s=>wc.executeJavaScript(s);
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  lab.getWindow().setContentSize(1280,800);
  report.errors=[];
  wc.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  const state=()=>run(`({angle:Number(document.getElementById('joint-actual').dataset.radians),mode:document.getElementById('control-deck').dataset.mode,title:document.getElementById('joint-title').textContent,selected:document.getElementById('joint-position').dataset.controlJoint,policyOutput:document.getElementById('joint-output').textContent})`);
  report.before=await state();
  await run(`document.getElementById('joint-position').value='35';document.getElementById('joint-position').dispatchEvent(new Event('input',{bubbles:true}));true`);
  await wait(700);
  report.after=await state();
  assert.ok(Math.abs(report.after.angle-report.before.angle)>0.2,'Dragging head yaw must visibly change the joint without pressing Play');
  assert.ok(Math.abs(report.after.angle-35*Math.PI/180)<0.02,'Paused pose must match the requested angle');
  assert.equal(report.after.mode,'manual');
  report.mapping=await run(`Array.from(document.querySelectorAll('.channel-row'),b=>({name:b.dataset.joint,index:Number(b.dataset.outputIndex),label:b.textContent}))`);
  assert.equal(report.mapping.length,14);
  assert.deepEqual(report.mapping.map(j=>j.index),Array.from({length:14},(_,i)=>i));
  const screenshot=async name=>fs.writeFileSync(path.join(root,'.release-reviews',name),(await wc.capturePage()).toPNG());
  await screenshot('lab-console-initial.png');
  const sliderBox=await run(`(()=>{const r=document.getElementById('joint-position').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const pointerBefore=(await state()).angle;
  const x=Math.round(sliderBox.x+sliderBox.width*0.62),y=Math.round(sliderBox.y+sliderBox.height/2);
  wc.sendInputEvent({type:'mouseMove',x,y});wc.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
  for(let dx=0;dx<25;dx+=5){wc.sendInputEvent({type:'mouseMove',x:x+dx,y,button:'left'});await wait(40);}
  wc.sendInputEvent({type:'mouseUp',x:x+20,y,button:'left',clickCount:1});await wait(250);
  report.pointer={before:pointerBefore,after:(await state()).angle};
  assert.ok(Math.abs(report.pointer.after-report.pointer.before)>0.1,'A real Chromium pointer drag must change the joint');
  const layout=await run(`({height:innerHeight,bar:document.querySelector('.simulation-bar').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth})`);
  report.layout1280=layout;assert.ok(layout.bar<=layout.height,'Transport should fit in the window');assert.equal(layout.overflow,false);
  report.controls=[];
  for(const name of ['left_hip_yaw','left_hip_roll','left_hip_pitch','left_knee','left_ankle','neck_pitch','head_pitch','head_roll','right_hip_yaw','right_hip_roll','right_hip_pitch','right_knee','right_ankle']){
    await run(`document.querySelector('.channel-row[data-joint="${name}"]').click();true`);
    const before=await state();
    await run(`document.getElementById('angle-plus').click();true`);await wait(180);
    const after=await state();
    assert.equal(after.selected,name);assert.ok(Math.abs(after.angle-before.angle)>0.04,`${name} must move`);
    report.controls.push({name,before:before.angle,after:after.angle});
  }
  await run(`document.querySelector('.joint-pin[data-joint="head_yaw"]').click();true`);
  assert.equal((await state()).selected,'head_yaw');
  await run(`document.querySelector('[data-part="head"]').click();document.getElementById('joint-home').click();true`);await wait(200);
  assert.ok(Math.abs((await state()).angle)<0.02);
  assert.equal(await run(`document.querySelectorAll('.channel-row:not([hidden])').length`),4);
  await run(`document.querySelector('[data-part="all"]').click();document.getElementById('reset').click();true`);await wait(200);
  assert.equal((await state()).mode,'policy');
  await run(`document.getElementById('play').click();true`);await wait(1000);
  report.policy=await run(`Array.from(document.querySelectorAll('.channel-row'),b=>b.dataset.policyOutput)`);
  assert.ok(report.policy.every(v=>v!==''&&Number.isFinite(Number(v))),'All 14 channels must report real ONNX outputs');
  await screenshot('lab-console-running.png');
  await run(`document.getElementById('play').click();document.getElementById('hologram').click();true`);await wait(300);
  assert.equal(await run(`document.getElementById('hologram').getAttribute('aria-pressed')`),'false');
  await screenshot('lab-console-solid.png');
  await run(`document.getElementById('hologram').click();document.getElementById('training-tab').click();true`);await wait(300);
  assert.equal(await run(`document.getElementById('training-view').hidden`),false);
  assert.ok(await run(`document.getElementById('reward').value.includes('reward_environment')`));
  await screenshot('lab-training.png');
  await run(`document.getElementById('control-tab').click();document.getElementById('reset').click();true`);await wait(300);
  lab.getWindow().setContentSize(1440,1040);await wait(600);
  await screenshot('lab-console-overview.png');
  lab.getWindow().setContentSize(1000,700);await wait(500);
  const compact=await run(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,slider:document.getElementById('joint-position').getBoundingClientRect().right})`);
  report.layout1000=compact;assert.equal(compact.overflow,false);assert.ok(compact.slider<compact.width);
  await screenshot('lab-console-compact.png');
  assert.deepEqual(report.errors,[]);
  report.ok=true;
 }catch(e){report.ok=false;report.error=e.message;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');await wait(150);}catch{}lab?.dispose();jobs?.dispose();fs.writeFileSync('/tmp/duck-control-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));fs.rmSync(tmp,{recursive:true,force:true});app.exit(report.ok?0:1);}
});
