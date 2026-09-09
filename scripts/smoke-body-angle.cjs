'use strict';
// Virtual laboratory only. Never load application main or activate a pet policy.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo;
const labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const evidence=path.join(repo,'.release-reviews/body-angle');
const records=JSON.parse(fs.readFileSync(path.join(evidence,'random-mcp.json'))).jobs;
const parent=records[0];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-body-angle-ui-'));
const output=process.env.DUCK_SMOKE_OUTPUT||path.join(evidence,'ui');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temp,'profile'));
const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
app.whenReady().then(async()=>{
 let lab,jobs;const report={errors:[]};
 try{
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:path.join(evidence,'random-jobs')});
  policies.installHandler(protocol,net,pathToFileURL,{resolveLabPolicy:id=>jobs.artifact(id)});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const win=lab.getWindow(),wc=win.webContents,run=code=>wc.executeJavaScript(code);win.setContentSize(1440,1000);
  wc.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  const until=async fn=>{for(let i=0;i<900;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Resume UI timeout');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  assert.equal(await run("document.getElementById('policy-initialization').value"),'official');
  await run(`document.getElementById('training-tab').click();document.getElementById('training-task').value='microduck-headstand-hold';document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
  await until(()=>run("!document.getElementById('training-task').disabled"));
  assert.equal(await run("document.getElementById('policy-initialization').value"),'random');
  const reward=await run("document.getElementById('reward').value");assert.match(reward,/torch.acos/);assert.doesNotMatch(reward,/reference_joint_error/);
  await run(`document.getElementById('runs').value=${JSON.stringify(parent.id)};document.getElementById('runs').dispatchEvent(new Event('change'));true`);
  await until(()=>run("!document.getElementById('resume').disabled"));
  assert.match(await run("document.getElementById('resume-status').textContent"),new RegExp(`第 ${parent.resume.iteration} 轮`));
  const before=jobs.get(parent.id).checkpoint.sha256;
  await run(`document.getElementById('python').value=${JSON.stringify(process.env.DUCK_LAB_PYTHON)};document.getElementById('resume-iterations').value='1';document.getElementById('resume').click();true`);
  await until(()=>run(`document.getElementById('runs').value!==${JSON.stringify(parent.id)}`));
  const id=await run("document.getElementById('runs').value");
  await until(()=>['completed','failed'].includes(jobs.get(id).phase));
  const child=jobs.get(id);assert.equal(child.phase,'completed',child.error);
  assert.equal(child.manifest.iterations,parent.resume.iteration+1);
  assert.equal(child.settings.resume_run_id,parent.id);assert.equal(child.progress,1);
  assert.equal(jobs.get(parent.id).checkpoint.sha256,before);
  await until(()=>run("!document.getElementById('resume').disabled"));
  assert.match(await run("document.getElementById('policy-run-note').textContent"),/接着第/);
  await run("document.querySelector('[data-lesson=\"3\"]').click();document.getElementById('evaluate').click();true");
  await until(()=>run("!document.getElementById('evaluate').disabled&&!document.getElementById('evaluation').textContent.includes('正在')"));
  report.evaluation=await run("document.getElementById('evaluation').textContent");assert.match(report.evaluation,/近倒立初态测试/);
  fs.writeFileSync(path.join(output,'body-angle.png'),(await wc.capturePage()).toPNG());
  assert.equal(jobs.activation().current,null);assert.deepEqual(report.errors,[]);
  report.child=child;report.parent=parent.id;report.ok=true;
 }catch(e){report.ok=false;report.error=e.stack;}
 finally{lab?.dispose();jobs?.dispose();fs.rmSync(temp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,error:report.error}));app.exit(report.ok?0:1);}
});
