'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const Module=require('node:module');
const {createRobotLabWindow}=require('../src/shell/robot-lab-window');

function harness(platform='darwin') {
  const app=new EventEmitter();let dockVisible=false,focused=null;
  const policies=[];
  app.dock={setIcon(){},isVisible:()=>dockVisible};
  app.setActivationPolicy=policy=>{policies.push(policy);dockVisible=policy==='regular';};
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.destroyed=false;this.minimized=false;this.visible=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>'';}
    static getFocusedWindow(){return focused;}
    isDestroyed(){return this.destroyed;}
    isMinimized(){return this.minimized;}
    isVisible(){return this.visible;}
    isFocused(){return focused===this;}
    show(){this.visible=true;}
    focus(){focused=this;}
    minimize(){this.minimized=true;focused=null;}
    restore(){this.minimized=false;}
    loadFile(){}
    destroy(){this.destroyed=true;if(focused===this)focused=null;this.emit('closed');}
  }
  const fakeElectron={app,BrowserWindow:Window};
  const file=require.resolve('../src/shell/menu'),load=Module._load,descriptor=Object.getOwnPropertyDescriptor(process,'platform');
  delete require.cache[file];let initMenu;
  try{
    Object.defineProperty(process,'platform',{...descriptor,value:platform});
    Module._load=function(request){if(request==='electron')return fakeElectron;return load.apply(this,arguments);};
    initMenu=require(file);
  }finally{Module._load=load;Object.defineProperty(process,'platform',descriptor);delete require.cache[file];}
  let menu;
  const lab=createRobotLabWindow({app,BrowserWindow:Window,ipcMain:{handle(){},removeHandler(){}},dialog:{},getJobs:()=>{throw Error('Window lifecycle must not start training');},onWindowChanged:()=>menu.applyDockVisibility()});
  const ctx={showDock:false,getRobotLabWindow:()=>lab.getWindow(),reapplyMacVisibility(){}};
  menu=initMenu(ctx);
  return {app,lab,menu,ctx,policies,Window};
}

test('lab holds macOS Dock visible across preference changes and minimization, then restores the current preference',async()=>{
  const {lab,menu,ctx,app}=harness();
  await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),false);
  lab.open();await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),true);
  assert.equal(ctx.showDock,false,'Opening a lab must not rewrite the pet preference');
  lab.getWindow().minimize();await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),true);
  ctx.showDock=true;await menu.applyDockVisibility();ctx.showDock=false;await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),true);
  lab.close();await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),false);
  lab.open();ctx.showDock=true;lab.close();await menu.applyDockVisibility();assert.equal(app.dock.isVisible(),true);
  lab.dispose();
});

test('lab lifecycle notifies Dock coordinator on open, native close and reopen without a preference event',async()=>{
  const {lab,app}=harness();const drain=()=>new Promise(resolve=>setImmediate(resolve));
  lab.open();await drain();assert.equal(app.dock.isVisible(),true);
  lab.getWindow().destroy();await drain();assert.equal(app.dock.isVisible(),false);
  lab.open();lab.close();lab.open();await drain();assert.equal(app.dock.isVisible(),true);
  lab.dispose();await drain();assert.equal(app.dock.isVisible(),false);
});

for(const platform of ['darwin','win32'])test(`${platform}: normal lab window can be minimized and restored without creating another window`,()=>{
  const {lab}=harness(platform);lab.open();const win=lab.getWindow();
  for(const [key,value] of Object.entries({skipTaskbar:false,frame:true,focusable:true,minimizable:true,maximizable:true,transparent:false,alwaysOnTop:false}))assert.equal(win.options[key],value,key);
  assert.equal(win.options.parent,undefined);
  win.minimize();lab.open();assert.equal(lab.getWindow(),win);assert.equal(win.isMinimized(),false);assert.equal(win.isFocused(),true);
  lab.dispose();
});

test('Dock activation restores the minimized lab and listener is removed on disposal',()=>{
  const {lab,app,Window}=harness();const before=app.listenerCount('activate');lab.open();const win=lab.getWindow();win.emit('ready-to-show');
  const settings=new Window({});settings.show();settings.focus();app.emit('activate');assert.equal(settings.isFocused(),true,'Do not steal focus from another normal window');
  win.minimize();app.emit('activate');assert.equal(win.isMinimized(),false);assert.equal(win.isFocused(),true);
  lab.dispose();assert.equal(app.listenerCount('activate'),before-1);
  app.emit('activate');assert.equal(lab.getWindow(),null,'Dock activation must not recreate a closed lab');
});

test('Windows does not apply macOS activation policy when opening or closing the lab',async()=>{
  const {lab,menu,policies}=harness('win32');lab.open();await menu.applyDockVisibility();lab.close();await menu.applyDockVisibility();assert.deepEqual(policies,[]);lab.dispose();
});
