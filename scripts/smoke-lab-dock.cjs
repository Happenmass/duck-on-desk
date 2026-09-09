'use strict';
// Real OS window lifecycle, isolated from App main, training and hardware.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.DUCK_SMOKE_APP_ROOT||path.join(__dirname,'..');
const output=process.env.DUCK_SMOKE_OUTPUT||path.join(__dirname,'../.release-reviews/lab-dock/source');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-lab-dock-'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(tmp,'profile'));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const report={platform:process.platform,scope:'real isolated laboratory window, no App main, training or hardware'};let lab,menu;
 try{
  if(process.platform==='darwin')app.dock.hide();
  lab=require(path.join(root,'src/shell/robot-lab-window')).createRobotLabWindow({app,BrowserWindow,ipcMain,dialog:{},getJobs:()=>{throw Error('No training service needed');},onWindowChanged:()=>menu.applyDockVisibility(),devUrl:'about:blank'});
  const ctx={showDock:false,getRobotLabWindow:()=>lab.getWindow(),reapplyMacVisibility(){}};
  menu=require(path.join(root,'src/shell/menu'))(ctx);
  lab.open();const win=lab.getWindow();
  const until=async fn=>{const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await wait(50);}throw Error('Window lifecycle timed out');};
  await until(()=>win.isVisible());await menu.applyDockVisibility();
  if(process.platform==='darwin'){
   report.dockVisibleWithLab=app.dock.isVisible();
   assert.equal(report.dockVisibleWithLab,true,'An open Robot Lab must appear in the Dock even when the pet Dock preference is off');
  }
  win.minimize();await until(()=>win.isMinimized());
  if(process.platform==='darwin'){await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),true,'Minimization and a disabled pet preference must not hide the lab Dock entry');}
  lab.open();await until(()=>!win.isMinimized());
  report.restored=!win.isMinimized();assert.equal(report.restored,true,'Reopening the lab must restore its minimized window');
  if(process.platform==='darwin'){
   // Cocoa finishes the restore animation after isMinimized() becomes false.
   await wait(800);
   win.minimize();await until(()=>win.isMinimized());app.emit('activate');await until(()=>!win.isMinimized());report.activationRestored=true;
  }
  lab.close();await menu.applyDockVisibility();report.closed=win.isDestroyed();assert.equal(report.closed,true);
  if(process.platform==='darwin'){
   report.dockHiddenAfterClose=!app.dock.isVisible();assert.equal(report.dockHiddenAfterClose,true);
   lab.open();ctx.showDock=true;await menu.applyDockVisibility();lab.close();await menu.applyDockVisibility();
   report.savedVisiblePreferenceRespected=app.dock.isVisible();assert.equal(report.savedVisiblePreferenceRespected,true);
  }
  assert.equal(lab.getWindow(),null);report.ok=true;
 }catch(error){report.ok=false;report.error=error.stack;}
 finally{lab?.dispose();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));fs.rmSync(tmp,{recursive:true,force:true});app.exit(report.ok?0:1);}
});
