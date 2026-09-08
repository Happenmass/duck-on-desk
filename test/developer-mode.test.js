'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createSettingsController}=require('../src/shell/settings-controller');
test('developer mode defaults off, gates lab commands and persists through the sole settings writer',async t=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'duck-developer-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  let opens=0;
  const prefsPath=path.join(tmp,'prefs.json');const controller=createSettingsController({prefsPath,injectedDeps:{openRobotLab:()=>opens++}});
  t.after(()=>controller.dispose());
  assert.equal(controller.get('developerMode'),false);
  assert.equal((await controller.applyCommand('openRobotLab')).status,'error');assert.equal(opens,0);
  assert.equal((await controller.applyUpdate('developerMode','true')).status,'error');
  assert.equal((await controller.applyUpdate('developerMode',true)).status,'ok');
  assert.equal((await controller.applyCommand('openRobotLab')).status,'ok');assert.equal(opens,1);
  const reloaded=createSettingsController({prefsPath});t.after(()=>reloaded.dispose());
  assert.equal(reloaded.get('developerMode'),true);
  assert.equal((await controller.applyUpdate('developerMode',false)).status,'ok');
  assert.equal((await controller.applyCommand('openRobotLab')).status,'error');
});
