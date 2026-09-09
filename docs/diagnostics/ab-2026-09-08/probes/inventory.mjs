import { evaluate, close } from './cdp.mjs';
import fs from 'node:fs';
const out = await evaluate(`(async () => {
  const { BrowserWindow } = process.mainModule.require('electron');
  const d = BrowserWindow.fromId(1).webContents.debugger;
  if (!d.isAttached()) d.attach('1.3');
  const r = await d.sendCommand('Runtime.evaluate', { expression: 'window.__duckRuntime' });
  const p = await d.sendCommand('Runtime.getProperties', { objectId: r.result.objectId, ownProperties: true });
  const scene = p.privateProperties.find(x => x.name === '#i').value.objectId;
  const res = await d.sendCommand('Runtime.callFunctionOn', {
    objectId: scene, returnByValue: true,
    functionDeclaration: \`function(){
      const meshes = [];
      this.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry;
        const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        meshes.push({ name: o.userData.meshName || ('<' + (o.name || o.type) + '>'), tris, visible: o.visible, parent: o.parent && o.parent.name });
      });
      return { total: meshes.length, tris: meshes.reduce((a, b) => a + b.tris, 0), meshes };
    }\`,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
})()`);
fs.writeFileSync('inventory.json', JSON.stringify(out, null, 2));
console.log('meshes:', out.total, 'triangles:', out.tris);
const byName = {};
for (const m of out.meshes) { byName[m.name] = byName[m.name] || { n: 0, tris: 0 }; byName[m.name].n++; byName[m.name].tris += m.tris; }
for (const [k, v] of Object.entries(byName).sort((a, b) => b[1].tris - a[1].tris))
  console.log(String(v.tris).padStart(7), '×' + String(v.n).padStart(2), ' ', k);
close();
