import { evaluate, close } from './cdp.mjs';
import fs from 'node:fs';
// Per-mesh-name pixel diff at the pet window's real backbuffer size, across
// yaw angles the duck actually presents. Both renders of a pair happen inside
// one synchronous call, so the pose is identical between them; only the
// mesh's visibility differs.
const out = await evaluate(`(async () => {
  const { BrowserWindow } = process.mainModule.require('electron');
  const d = BrowserWindow.fromId(1).webContents.debugger;
  if (!d.isAttached()) d.attach('1.3');
  const r = await d.sendCommand('Runtime.evaluate', { expression: 'window.__duckRuntime' });
  const p = await d.sendCommand('Runtime.getProperties', { objectId: r.result.objectId, ownProperties: true });
  const id = n => p.privateProperties.find(x => x.name === n).value.objectId;
  const res = await d.sendCommand('Runtime.callFunctionOn', {
    objectId: id('#i'), returnByValue: true,
    arguments: [{ objectId: id('#a') }, { objectId: id('#r') }, { objectId: id('#o') }],
    functionDeclaration: \`function(camera, renderer, rig){
      const scene = this;
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const buf = new Uint8Array(w * h * 4);
      const shot = () => { renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf.slice(); };
      const names = new Map();
      scene.traverse(o => { if (o.isMesh && o.userData.meshName) { const k = o.userData.meshName; (names.get(k) || names.set(k, []).get(k)).push(o); } });
      const yaws = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 5*Math.PI/4, 3*Math.PI/2, 7*Math.PI/4];
      const baseYaw = rig.root.rotation.y;
      const result = [];
      for (const [name, objs] of names) {
        let changed = 0, maxDelta = 0;
        for (const yaw of yaws) {
          rig.root.rotation.y = baseYaw + yaw;
          const before = shot();
          for (const o of objs) o.visible = false;
          const after = shot();
          for (const o of objs) o.visible = true;
          for (let i = 0; i < before.length; i += 4) {
            const dl = Math.abs(before[i]-after[i]) + Math.abs(before[i+1]-after[i+1])
                     + Math.abs(before[i+2]-after[i+2]) + Math.abs(before[i+3]-after[i+3]);
            if (dl) { changed++; if (dl > maxDelta) maxDelta = dl; }
          }
        }
        result.push({ name, instances: objs.length, changedPixels: changed, maxDelta });
      }
      rig.root.rotation.y = baseYaw;
      return { width: w, height: h, pixelsPerShot: w * h, yaws: yaws.length, result };
    }\`,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
})()`);
fs.writeFileSync('pixeldiff.json', JSON.stringify(out, null, 2));
console.log(`backbuffer ${out.width}x${out.height} = ${out.pixelsPerShot} px, ${out.yaws} yaw angles`);
const inv = JSON.parse(fs.readFileSync('inventory.json', 'utf8'));
const tris = {}; for (const m of inv.meshes) tris[m.name] = (tris[m.name] || 0) + m.tris;
const zero = out.result.filter(r => r.changedPixels === 0).sort((a, b) => (tris[b.name] || 0) - (tris[a.name] || 0));
const nonzero = out.result.filter(r => r.changedPixels > 0).sort((a, b) => a.changedPixels - b.changedPixels);
console.log(`\n== 0 changed pixels at every angle (${zero.length} names) ==`);
for (const r of zero) console.log(String(tris[r.name] || 0).padStart(7), '×' + String(r.instances).padStart(2), ' ', r.name);
console.log(`\n== visible (${nonzero.length} names) ==`);
for (const r of nonzero) console.log(String(r.changedPixels).padStart(7), 'px  max Δ', String(r.maxDelta).padStart(4), ' ', r.name);
const hidTris = zero.reduce((a, r) => a + (tris[r.name] || 0), 0);
const hidObjs = zero.reduce((a, r) => a + r.instances, 0);
console.log(`\nhideable: ${hidObjs}/${inv.total} draw calls, ${hidTris}/${inv.tris} triangles (${(100*hidTris/inv.tris).toFixed(1)}%)`);
close();
