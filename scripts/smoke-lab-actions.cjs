'use strict';
// Inspect the real first action policy in an isolated virtual lab, never App main.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const source=JSON.parse(fs.readFileSync(path.join(repo,'.release-reviews/duck-actions/first-training.json'),'utf8'));
const id=source.job.id,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-lab-actions-')),jobRoot=path.join(tmp,'lab'),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/duck-actions/lab');
fs.mkdirSync(path.join(jobRoot,'jobs'),{recursive:true});fs.mkdirSync(output,{recursive:true});
// Only job metadata is copied. The ONNX stays in the canonical global HF cache.
fs.copyFileSync(path.join(os.homedir(),'.duck-on-desk/robot-lab/jobs',id+'.json'),path.join(jobRoot,'jobs',id+'.json'));
app.setPath('userData',path.join(tmp,'profile'));const policies=require(path.join(root,'src/robots/duck/pet-model-protocol'));policies.registerScheme(protocol);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let lab,jobs;const report={time:new Date().toISOString(),run:id,errors:[]};
 try{
  jobs=require(path.join(labRoot,'jobs.cjs')).createLabJobs({root:jobRoot});
  policies.installHandler(protocol,net,pathToFileURL,{resolveLabPolicy:id=>jobs.artifact(id)});
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>jobs});lab.open({lesson:'actions'});
  const win=lab.getWindow(),wc=win.webContents,run=code=>wc.executeJavaScript(code);win.setContentSize(1440,960);
  wc.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  const until=async(fn,timeout=45000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Lab action UI timed out');};
  await until(()=>run('document.getElementById("runtime-status")?.textContent.includes("仿真就绪")'));
  await until(()=>run("document.getElementById('training-task').value==='microduck-headstand' && !document.getElementById('training-task').disabled && !document.getElementById('training-view').hidden"));
  report.menuEntryOpenedSecondLesson=true;
  // The dance course is deferred. Inject a QA-only selector to inspect historical artifacts.
  assert.equal(await run("document.querySelector('#training-task option[value=\"microduck-headstand-dance\"]')===null"),true);
  await run("document.getElementById('training-task').add(new Option('历史街舞实验（仅测试）','microduck-headstand-dance'));true");
  await run("document.getElementById('training-task').value='microduck-headstand-dance';document.getElementById('training-task').dispatchEvent(new Event('change'));true");
  await until(()=>run("!document.getElementById('training-task').disabled"));
  report.lesson=await run("({title:document.querySelector('[data-lesson-page=\"0\"] h2').textContent,reward:document.getElementById('reward').value,hidden:document.querySelector('[data-walk-only]').hidden,python:document.getElementById('python').value})");
  assert.match(report.lesson.title,/倒立/);assert.match(report.lesson.reward,/phase/);assert.equal(report.lesson.hidden,true);
  // Keep custom drafts when switching lessons; the walking default must remain unchanged.
  await run("document.getElementById('reward').value+='\\n# retained action draft';document.getElementById('training-task').value='microduck-flat-walk';document.getElementById('training-task').dispatchEvent(new Event('change'));true");
  await until(()=>run("!document.getElementById('training-task').disabled"));
  report.walkDraft=await run("({reward:document.getElementById('reward').value,speed:document.getElementById('target-speed').value})");
  assert.match(report.walkDraft.reward,/heading/);assert.equal(report.walkDraft.speed,'0.25');assert.doesNotMatch(report.walkDraft.reward,/retained action/);
  await run("document.getElementById('training-task').value='microduck-headstand-dance';document.getElementById('training-task').dispatchEvent(new Event('change'));true");
  await until(()=>run("!document.getElementById('training-task').disabled"));assert.match(await run("document.getElementById('reward').value"),/retained action draft/);
  await run("document.querySelector('.action-library').open=true;document.querySelector('[data-lesson=\"3\"]').click();true");
  await wait(300);
  report.native=await run("({message:document.getElementById('evaluation').textContent,disabled:document.getElementById('apply').disabled,library:document.getElementById('action-library-list').textContent})");
  assert.match(report.native.message,/倒立/);assert.equal(report.native.disabled,true);assert.doesNotMatch(report.native.library,/倒立跳街舞/);
  await until(()=>run("!document.getElementById('evaluate').disabled"));
  await run("document.getElementById('evaluate').click();true");
  await until(()=>run("!document.getElementById('evaluate').disabled && !document.getElementById('evaluation').textContent.includes('正在')"));
  report.browser=await run("({message:document.getElementById('evaluation').textContent,disabled:document.getElementById('apply').disabled,notice:document.getElementById('notice').textContent})");
  assert.doesNotMatch(report.browser.message,/训练端三段/,report.browser.notice);
  assert.match(report.browser.message,/倒立 0.00 秒/);assert.match(report.browser.message,/尚未完成/);assert.equal(report.browser.disabled,true);
  fs.writeFileSync(path.join(output,'second-lesson.png'),(await wc.capturePage()).toPNG());
  await run("document.getElementById('preview').click();true");
  await until(()=>run("document.getElementById('controller-label').textContent==='动作模型'"));
  report.preview=await run("document.getElementById('view-state').textContent");await wait(11000);
  report.afterPreview=await run("({state:document.getElementById('view-state').textContent,button:document.getElementById('play').textContent})");assert.equal(report.afterPreview.button,'运行仿真');
  assert.deepEqual(report.errors,[]);report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
