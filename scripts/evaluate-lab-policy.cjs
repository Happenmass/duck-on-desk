'use strict';
// Evaluate cached training policies in the real browser WASM runtime. No App main or activation.
// electron scripts/evaluate-lab-policy.cjs report.json run_id [run_id ...]
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLabJobs}=require('../mcp/robot-lab/jobs.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-policy-eval-'));
app.setPath('userData',path.join(tmp,'profile'));
const reportFile=path.resolve(process.argv[2]),ids=process.argv.slice(3);
const jobs=createLabJobs();const report={date:new Date().toISOString(),scope:'isolated browser WASM evaluation; no desktop assists, application or hardware',trials:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let window;
 try{
  window=new BrowserWindow({width:1280,height:850,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  await window.loadURL('http://127.0.0.1:5176/lab.html');const run=s=>window.webContents.executeJavaScript(s);
  const end=Date.now()+45000;while(!await run(`document.getElementById('runtime-status')?.textContent.includes('仿真就绪')`)){if(Date.now()>end)throw Error('Lab load timed out');await wait(150);}
  const first=jobs.get(ids[0]);jobs.artifact(ids[0]);
  await run(`document.getElementById('training-tab').click();document.getElementById('runs').value=${JSON.stringify(ids[0])};document.getElementById('runs').dispatchEvent(new Event('change'));true`);
  await wait(350);await run(`document.querySelector('[data-lesson="3"]').click();document.getElementById('preview').click();true`);
  const previewDeadline=Date.now()+15000;
  while(!await run(`!document.getElementById('control-view').hidden&&Number(document.getElementById('forward').value)===${first.settings.target_speed}`)){if(Date.now()>previewDeadline)throw Error('Candidate preview did not retain its training speed');await wait(100);}
  report.preview_target_speed=await run(`Number(document.getElementById('forward').value)`);
  await run(`(async()=>{document.getElementById('training-tab').click();const {createDuckRuntime}=await import('/src/runtime/duck-runtime.js');const stage=document.createElement('div');stage.style.cssText='position:fixed;inset:0;z-index:100;background:#0b1720';document.body.append(stage);window.__policyEval=await createDuckRuntime({container:stage,policyUrl:name=>'/policies/'+encodeURIComponent(name),mode:'lab',quality:{fps:15,shadows:false,pixelRatio:1}});window.__policyEval.labView('visible',false);return true;})()`);
  for(const id of ids){
   jobs.artifact(id);const job=jobs.get(id),target=job.settings.target_speed;
   const url='/policies/'+encodeURIComponent(`lab/${id}/policy.onnx`);
   const evaluation=await run(`(async()=>{
     const runtime=window.__policyEval,original=runtime.labSnapshot.bind(runtime),initialFacing=runtime.snapshot().facing;
     let part=0,lastTime=-1;const traces=[[],[]];
     runtime.labSnapshot=()=>{const state=original();if(state.time<lastTime)part++;lastTime=state.time;
       const difference=initialFacing-runtime.snapshot().facing;const yaw=Math.atan2(Math.sin(difference),Math.cos(difference));
       traces[part]?.push({time:state.time,position:state.position,yaw,velocity:state.velocity});return state;};
     try{const result=await runtime.evaluateWalkPolicy(${JSON.stringify(url)},${target},1500);
       return {...result,heading:traces.map(rows=>({max_abs_yaw_degrees:Math.max(...rows.map(r=>Math.abs(r.yaw)))*180/Math.PI,last:rows.at(-1),trajectory:rows.filter((_,i)=>i%50===0)}))};
     }finally{runtime.labSnapshot=original;}
   })()`);
   report.trials.push({id,target_speed:target,...evaluation,error_reduction:1-evaluation.velocity_mae/evaluation.baseline.velocity_mae});
   console.log(JSON.stringify(report.trials.at(-1)));
  }
  report.ok=report.trials.every(r=>r.steps===1500&&!r.nonFinite&&r.fall_rate===0);
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{
  try{await window?.webContents.executeJavaScript(`window.__policyEval?.dispose();window.dispatchEvent(new Event('beforeunload'));true`);}catch{}
  window?.destroy();jobs.dispose();fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');fs.rmSync(tmp,{recursive:true,force:true});app.exit(report.ok?0:1);
 }
});
