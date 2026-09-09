'use strict';
// Inspect the real first action policy in an isolated virtual lab, never App main.
const {app,BrowserWindow,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const repo=path.join(__dirname,'..'),root=process.env.DUCK_SMOKE_APP_ROOT||repo,labRoot=process.env.DUCK_SMOKE_LAB_ROOT||path.join(root,'mcp/robot-lab');
const source=JSON.parse(fs.readFileSync(process.env.DUCK_HEADSTAND_REPORT||path.join(repo,'.release-reviews/headstand/first-training.json'),'utf8'));
const task=source.job.settings.task;
const id=source.job.id,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-lab-headstand-')),jobRoot=path.join(tmp,'lab'),output=process.env.DUCK_SMOKE_OUTPUT||path.join(repo,'.release-reviews/headstand/lab');
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
  await until(()=>run("document.getElementById('training-task').value==='microduck-headstand-hold' && !document.getElementById('training-task').disabled && !document.getElementById('training-view').hidden"));
  report.menuEntryOpenedSecondLesson=true;
  report.courses=await run("Array.from(document.getElementById('training-task').options,option=>option.value)");
  assert.deepEqual(report.courses,['microduck-flat-walk','microduck-headstand-hold','microduck-headstand']);
  report.roadmap=await run("({visible:document.getElementById('action-roadmap').checkVisibility(),steps:Array.from(document.querySelectorAll('#action-roadmap li'),node=>node.textContent)})");
  assert.equal(report.roadmap.visible,true);assert.match(report.roadmap.steps[0],/近倒立.*保持/);assert.match(report.roadmap.steps[1],/从站立翻转.*尚未开放/);assert.match(report.roadmap.steps[2],/恢复正立.*尚未开放/);assert.match(report.roadmap.steps[3],/完整动作通过后.*街舞/);
  fs.writeFileSync(path.join(output,'action-roadmap.png'),(await wc.capturePage()).toPNG());
  win.setContentSize(1000,700);await wait(150);
  assert.ok(await run("document.documentElement.scrollWidth<=innerWidth"),'Course roadmap must fit a narrow window');
  await run("document.getElementById('action-roadmap').scrollIntoView({block:'center'});true");
  fs.writeFileSync(path.join(output,'action-roadmap-1000.png'),(await wc.capturePage()).toPNG());
  win.setContentSize(1440,960);await run('scrollTo(0,0);true');
  if(task!=='microduck-headstand-hold'){await run(`document.getElementById('training-task').value=${JSON.stringify(task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);await until(()=>run("!document.getElementById('training-task').disabled"));}
  await run("document.querySelector('[data-concept=\"reward\"]').click();true");
  assert.match(await run("document.getElementById('concept-detail').textContent"),/不要求跳动或起身/);
  await until(()=>run("!document.getElementById('training-task').disabled"));
  report.lesson=await run("({title:document.querySelector('[data-lesson-page=\"0\"] h2').textContent,reward:document.getElementById('reward').value,hidden:document.querySelector('[data-walk-only]').hidden,python:document.getElementById('python').value})");
  assert.match(report.lesson.title,/倒立/);assert.match(report.lesson.reward,/head_contact/);assert.equal(report.lesson.hidden,true);
  if(source.job.metrics.at(-1)?.reward_breakdown_status==='verified'){
    const latest=source.job.metrics.at(-1);
    await until(()=>run("document.querySelector('[data-metric=\"headstand_max_hold_seconds\"] output').dataset.value!==''"));
    report.posture=await run("({hold:Number(document.querySelector('[data-metric=\"headstand_max_hold_seconds\"] output').dataset.value),percent:Number(document.querySelector('[data-metric=\"headstand_valid_percent\"] output').dataset.value),breakdown:document.querySelector('.reward-breakdown table').textContent,curves:document.querySelectorAll('.posture-metrics .curve-line').length})");
    assert.equal(report.posture.hold,latest.headstand_max_hold_seconds);assert.equal(report.posture.percent,latest.headstand_valid_percent);
    assert.equal(report.posture.curves,2);assert.match(report.posture.breakdown,/支撑与身体姿态/);assert.match(report.posture.breakdown,/实际运动与关节范围/);
    await run("document.querySelector('[data-metric=\"headstand_max_hold_seconds\"] svg').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));true");
    assert.match(await run("document.querySelector('.reward-breakdown p').textContent"),/第 1 轮/);
    await run("document.querySelector('[data-metric=\"headstand_max_hold_seconds\"] svg').dispatchEvent(new Event('blur'));document.querySelector('.posture-metrics').scrollIntoView({block:'start'});true");await wait(150);
    fs.writeFileSync(path.join(output,'posture-metrics.png'),(await wc.capturePage()).toPNG());
    win.setContentSize(1000,700);await wait(150);assert.ok(await run('document.documentElement.scrollWidth<=innerWidth'),'Posture charts fit a narrow window');
    fs.writeFileSync(path.join(output,'posture-metrics-1000.png'),(await wc.capturePage()).toPNG());win.setContentSize(1440,960);
  }else{
    assert.equal(await run("document.querySelector('[data-metric=\"headstand_max_hold_seconds\"] output').dataset.value"),'','Historical jobs have gaps, not invented zero holds');
  }
  // Keep custom drafts when switching lessons; the walking default must remain unchanged.
  await run("document.getElementById('reward').value+='\\n# retained action draft';document.getElementById('training-task').value='microduck-flat-walk';document.getElementById('training-task').dispatchEvent(new Event('change'));true");
  await until(()=>run("!document.getElementById('training-task').disabled"));
  report.walkDraft=await run("({reward:document.getElementById('reward').value,speed:document.getElementById('target-speed').value})");
  assert.match(report.walkDraft.reward,/heading/);assert.equal(report.walkDraft.speed,'0.25');assert.doesNotMatch(report.walkDraft.reward,/retained action/);
  await run(`document.getElementById('training-task').value=${JSON.stringify(task)};document.getElementById('training-task').dispatchEvent(new Event('change'));true`);
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
  assert.match(report.browser.message,/最长连续倒立/);assert.match(report.browser.message,/结尾保持/);assert.equal(report.browser.disabled,true);
  fs.writeFileSync(path.join(output,'headstand-results.png'),(await wc.capturePage()).toPNG());
  await run("document.getElementById('preview').click();true");
  await until(()=>run("document.getElementById('controller-label').textContent==='动作模型'"));
  report.preview=await run("document.getElementById('view-state').textContent");await until(()=>run("document.getElementById('play').textContent==='运行仿真'"),60000);
  report.afterPreview=await run("({state:document.getElementById('view-state').textContent,button:document.getElementById('play').textContent})");assert.equal(report.afterPreview.button,'运行仿真');
  fs.writeFileSync(path.join(output,'headstand-preview.png'),(await wc.capturePage()).toPNG());
  await run("document.getElementById('training-tab').click();document.querySelector('[data-lesson=\"1\"]').click();true");
  assert.ok(await run("document.getElementById('reward').checkVisibility()"));
  assert.ok(await run("document.querySelector('details.action-reward-guide:not([hidden])').checkVisibility()"));
  assert.deepEqual(report.errors,[]);report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{try{await lab?.getWindow()?.webContents.executeJavaScript('window.dispatchEvent(new Event("beforeunload"));true');}catch{}lab?.dispose();jobs?.dispose();fs.rmSync(tmp,{recursive:true,force:true});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));app.exit(report.ok?0:1);}
});
