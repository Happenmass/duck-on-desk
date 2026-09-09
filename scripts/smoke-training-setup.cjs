'use strict';
// Actual native training without system Python or hardware adapters. CI runs
// this before prefetching models, then again against the packaged MCP resources.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const repo=path.resolve(__dirname,'..');
 const packaged=process.argv.includes('--packaged');
 const lab=process.env.DUCK_SMOKE_LAB_ROOT||(packaged?(process.platform==='win32'?path.join(repo,'dist/win-unpacked/resources/robot-lab-mcp'):path.join(repo,`dist/mac${process.arch==='arm64'?'-arm64':''}/Duck on Desk.app/Contents/Resources/robot-lab-mcp`)):path.join(repo,'mcp/robot-lab'));
 if(packaged){
  const asar=require('@electron/asar'),vm=require('node:vm');
  const archive=path.join(lab,'../app.asar');
  const source=asar.extractFile(archive,path.join('src','robots','duck','pet-model-protocol.js')).toString();
  const sandbox={require,module:{exports:{}},__dirname:path.join(archive,'src/robots/duck')};
  vm.runInNewContext(source,sandbox);assert.equal(sandbox.module.exports.SCHEME,'pet-model');
 }
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'duck-setup-smoke-'));
 // Deliberately ignore the developer's configured Python environment.
 delete process.env.DUCK_LAB_PYTHON;
 const jobs=require(path.join(lab,'jobs.cjs')).createLabJobs({root});
 let runId;
 try{
  const job=jobs.start({pythonPath:'',training_device:'cpu',inference_device:'cpu',task:'microduck-headstand-hold',iterations:1,environments:2,rollout_steps:8});runId=job.id;
  let previous='';const started=Date.now();
  while(Date.now()-started<25*60*1000){
   const state=jobs.get(job.id),message=`${state.phase}: ${state.preparation||''}`;
   if(message!==previous){console.log(message);previous=message;}
   if(['completed','failed','cancelled'].includes(state.phase)){
    assert.equal(state.phase,'completed',state.error);assert.equal(state.manifest.environment_steps,16);
    assert.ok(fs.existsSync(jobs.artifact(job.id)));assert.ok(state.manifest.onnx_export_max_error<1e-5);
    console.log(JSON.stringify({ok:true,packaged,platform:process.platform,arch:process.arch,seconds:(Date.now()-started)/1000,environment_steps:16,export_error:state.manifest.onnx_export_max_error,cuda:'not tested: CPU runner'}));
    await new Promise(r=>setTimeout(r,1500));return;
   }
   await new Promise(r=>setTimeout(r,1000));
  }throw Error('Training preparation smoke timed out');
 }finally{
  jobs.dispose();fs.rmSync(root,{recursive:true,force:true});
  if(runId)fs.rmSync(path.join(os.homedir(),'.cache/huggingface/microduck-robot-lab',runId),{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
