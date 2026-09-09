'use strict';
const path = require('node:path');

function createRobotLabWindow({app, BrowserWindow, ipcMain, dialog, getJobs, onApply = async () => {}, onActionsChange = () => {}, onWindowChanged = () => {}, devUrl = null}) {
  let window = null;
  function showAndFocus() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized?.()) window.restore();
    window.show();window.focus();
  }
  function onActivate() {
    if (!window || window.isDestroyed()) return;
    // A Dock click should recover the lab, while Cmd+Tab keeps another focused
    // normal window (such as Settings) in front.
    if (window.isMinimized() || !window.isVisible() || !BrowserWindow.getFocusedWindow()) showAndFocus();
  }
  app.on?.('activate',onActivate);
  const jobs = () => getJobs();
  const policyUrl = id => id ? `pet-model://policy/${encodeURIComponent(`lab/${id}/policy.onnx`)}` : null;
  const trusted = event => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle('robot-lab:request', async (event, {action, payload = {}} = {}) => {
    if (!trusted(event)) throw new Error('Robot Lab requests require the laboratory window');
    try {
      switch(action) {
        case 'bootstrap': return {defaults:jobs().defaults(), jobs:jobs().list(), active:jobs().activation()};
        case 'action-defaults': return payload.task==='microduck-flat-walk'?jobs().defaults():payload.task==='microduck-headstand-hold'?jobs().holdDefaults():payload.task==='microduck-headstand'?jobs().headstandDefaults():jobs().actionDefaults();
        case 'actions': return jobs().actions();
        case 'add-action': { const result=jobs().addAction(payload.id,payload.name,payload.evaluation);await onActionsChange();return result; }
        case 'remove-action': { const result=jobs().removeAction(payload.id);await onActionsChange();return result; }
        case 'setup': return jobs().setup(payload);
        case 'environment': return jobs().environment();
        case 'start': return jobs().start(payload);
        case 'resume': return jobs().resume(payload.id,payload);
        case 'list': return jobs().list();
        case 'get': return jobs().get(payload.id);
        case 'cancel': return jobs().cancel(payload.id);
        case 'live-preview': return jobs().preview(payload.id,payload.enabled);
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
  function open({lesson} = {}) {
    if(window&&!window.isDestroyed()){onWindowChanged();showAndFocus();if(lesson==='actions'){const contents=window.webContents;const send=()=>{if(!contents.isDestroyed?.())contents.send('robot-lab:lesson','actions');};if(contents.isLoading?.())contents.once('did-finish-load',send);else send();}return;}
    window = new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:680,title:'Robot Lab · Duck on Desk',
      frame:true,skipTaskbar:false,focusable:true,minimizable:true,maximizable:true,
      icon:path.join(__dirname,'../../assets/icons/256x256.png'),
      transparent:false,alwaysOnTop:false,resizable:true,backgroundColor:'#0b121d',show:false,
      webPreferences:{preload:path.join(__dirname,'../preload-robot-lab.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const createdWindow=window;
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL())event.preventDefault();});
    window.once('ready-to-show',()=>{if(window===createdWindow)showAndFocus();});
    window.on('closed',()=>{if(window===createdWindow){window=null;onWindowChanged();}});
    onWindowChanged();
    if(devUrl)window.loadURL(devUrl+(lesson==='actions'?'#actions':''));
    else window.loadFile(path.join(__dirname,'../../renderer-dist/lab.html'),lesson==='actions'?{hash:'actions'}:undefined);
  }
  function close() { window?.destroy(); window=null; }
  return {open,close,getWindow:()=>window,dispose:()=>{app.removeListener?.('activate',onActivate);close();ipcMain.removeHandler('robot-lab:request');}};
}
module.exports={createRobotLabWindow};
