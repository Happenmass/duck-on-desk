'use strict';
// Both fine-tuned artifacts through the real lab UI; no application main or activation.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const source=JSON.parse(fs.readFileSync(path.join(repo,'.release-reviews/official-finetune/training.json'),'utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-full-finetune-')),jobRoot=path.join(tmp,'lab'),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/official-finetune/packaged');
fs.mkdirSync(path.join(jobRoot,'jobs'),{recursive:true});fs.mkdirSync(output,{recursive:true});
for(const job of source.jobs)fs.copyFileSync(path.join(os.homedir(),'.duck-on-desk/robot-lab/jobs',job.id+'.json'),path.join(jobRoot,'jobs',job.id+'.json'));
app.setPath('userData',path.join(tmp,'profile'));const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let lab,jobs;const report={scope:'virtual lab UI and real exported weights, no activation',runs:[],errors:[]};
 try{
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:jobRoot});policies.installHandler(protocol,net,pathToFileURL,{resolveLabPolicy:id=>jobs.artifact(id)});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open();
  const win=lab.getWindow(),wc=win.webContents,run=s=>wc.executeJavaScript(s);win.setContentSize(1440,960);
  wc.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  const until=async fn=>{const end=Date.now()+60000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Fine-tuning UI timed out');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  await run("document.getElementById('training-tab').click();true");
  for(const job of source.jobs){
   await run(`document.getElementById('training-task').value=${JSON.stringify(job.settings.task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
   await until(()=>run(`!document.getElementById('training-task').disabled&&document.getElementById('runs').value===${JSON.stringify(job.id)}`));
   const script=await run("({code:document.getElementById('strategy').value,readonly:document.getElementById('strategy').readOnly,note:document.getElementById('policy-run-note').textContent})");
   assert.equal(script.code,jobs.defaults().strategy);assert.ok(script.readonly);assert.match(script.note,/官方原始权重.*全量微调.*197,774/);
   await run("document.querySelector('[data-lesson=\"3\"]').click();document.getElementById('evaluate').click();true");
   await until(()=>run("!document.getElementById('evaluate').disabled&&!document.getElementById('evaluation').textContent.includes('正在')"));
   const result=await run("({message:document.getElementById('evaluation').textContent,disabled:document.getElementById('apply').disabled,notice:document.getElementById('notice').textContent})");
   if(job.settings.task==='microduck-flat-walk')assert.match(result.message,/再次对比/);
   else{assert.match(result.message,/近倒立初态测试/);assert.equal(result.disabled,true);}
   assert.ok(!result.notice);report.runs.push({id:job.id,task:job.settings.task,script,...result});
   fs.writeFileSync(path.join(output,job.settings.task+'.png'),(await wc.capturePage()).toPNG());
  }
  assert.deepEqual(report.errors,[]);assert.equal(jobs.activation().current,null);report.ok=true;
 }catch(e){report.ok=false;report.error=e.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
