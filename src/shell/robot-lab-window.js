'use strict';
const path = require('node:path');

function createRobotLabWindow({app, BrowserWindow, ipcMain, dialog, getJobs, onApply = async () => {}, devUrl = null}) {
  let window = null;
  const jobs = () => getJobs();
  const policyUrl = id => id ? `pet-model://policy/${encodeURIComponent(`lab/${id}/policy.onnx`)}` : null;
  const trusted = event => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle('robot-lab:request', async (event, {action, payload = {}} = {}) => {
    if (!trusted(event)) throw new Error('Robot Lab requests require the laboratory window');
    try {
      switch(action) {
        case 'bootstrap': return {defaults:jobs().defaults(), jobs:jobs().list(), active:jobs().activation()};
        case 'start': return jobs().start(payload);
        case 'list': return jobs().list();
        case 'get': return jobs().get(payload.id);
        case 'cancel': return jobs().cancel(payload.id);
        case 'policy': jobs().artifact(payload.id); return {url:policyUrl(payload.id)};
        case 'apply': { const result=jobs().apply(payload.id,payload.evaluation); await onApply(policyUrl(result.current));return result; }
        case 'rollback': { const result=jobs().rollback();await onApply(policyUrl(result.current));return result; }
        case 'export': {
          const source=jobs().artifact(payload.id,'policy.onnx');
          const result=await dialog.showSaveDialog(window,{title:'导出训练策略',defaultPath:`${payload.id}.onnx`,filters:[{name:'ONNX',extensions:['onnx']}]});
          if(result.canceled||!result.filePath)return{cancelled:true};
          // This export is user-requested; the canonical weights remain in the global cache.
          const fs=require('node:fs');fs.copyFileSync(source,result.filePath);
          fs.copyFileSync(jobs().artifact(payload.id,'manifest.json'),`${result.filePath}.manifest.json`);
          return{path:result.filePath};
        }
        default: throw new Error('Unknown Robot Lab action');
      }
    } catch(error) { return {error:error.message}; }
  });
  function open() {
    if(window&&!window.isDestroyed()){window.show();window.focus();return;}
    window = new BrowserWindow({width:1280,height:820,minWidth:1000,minHeight:680,title:'Robot Lab · Duck on Desk',
      transparent:false,alwaysOnTop:false,resizable:true,backgroundColor:'#0b121d',show:false,
      webPreferences:{preload:path.join(__dirname,'../preload-robot-lab.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
    window.once('ready-to-show',()=>window?.show());
    window.on('closed',()=>{window=null;});
    if(devUrl)window.loadURL(devUrl);
    else window.loadFile(path.join(__dirname,'../../renderer-dist/lab.html'));
  }
  function close() { window?.destroy(); window=null; }
  return {open,close,getWindow:()=>window,dispose:()=>{close();ipcMain.removeHandler('robot-lab:request');}};
}
module.exports={createRobotLabWindow};
