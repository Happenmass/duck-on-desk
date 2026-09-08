'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createRobotLabWindow}=require('../src/shell/robot-lab-window');
test('Robot Lab creates an isolated normal window lazily and rejects other IPC senders',async()=>{
  let handler,instances=0,jobRequests=0,closed=false,applied;
  class Window extends EventEmitter {
    constructor(options){super();instances++;this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>this.url;}
    isDestroyed(){return closed;}show(){}focus(){}loadFile(file){this.url=file;}destroy(){closed=true;this.emit('closed');}
  }
  const lab=createRobotLabWindow({app:{},BrowserWindow:Window,ipcMain:{handle:(_,fn)=>handler=fn,removeHandler:()=>{}},dialog:{},getJobs:()=>{jobRequests++;return {defaults:()=>({}),list:()=>[],activation:()=>({current:null}),apply:()=>({current:'run_x'}),rollback:()=>({current:null})};},onApply:url=>{applied=url;}});
  assert.equal(instances,0);assert.equal(jobRequests,0);lab.open();lab.open();assert.equal(instances,1);
  const window=lab.getWindow();assert.equal(window.options.transparent,false);assert.equal(window.options.alwaysOnTop,false);assert.equal(window.options.resizable,true);assert.equal(window.options.webPreferences.sandbox,true);
  await assert.rejects(handler({sender:{}},{action:'bootstrap'}),/laboratory/);
  await assert.rejects(handler({sender:window.webContents,senderFrame:{}},{action:'bootstrap'}),/laboratory/);
  const event={sender:window.webContents,senderFrame:window.webContents.mainFrame};
  assert.deepEqual((await handler(event,{action:'bootstrap'})).jobs,[]);
  await handler(event,{action:'apply',payload:{id:'x'}});assert.match(applied,/pet-model:\/\/policy\/lab%2Frun_x/);
  await handler(event,{action:'rollback'});assert.equal(applied,null);
  window.destroy();assert.equal(lab.getWindow(),null);await assert.rejects(handler(event,{action:'list'}));lab.dispose();
});
