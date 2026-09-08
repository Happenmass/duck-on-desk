'use strict';
// Virtual Robot Lab only: does not start the pet, hooks or hardware adapters.
const {spawn}=require('node:child_process');
const path=require('node:path');
const child=spawn(process.execPath,[path.join(__dirname,'../node_modules/vite/bin/vite.js'),'--config','renderer/vite.config.js','--host','127.0.0.1','--open','/lab.html'],{
  cwd:path.join(__dirname,'..'),stdio:'inherit',env:{...process.env,DUCK_LAB_DEV:'1'},
});
child.on('exit',code=>{process.exitCode=code||0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
