import { evaluate, close } from './cdp.mjs';
// Install a controller in the pet page holding scene/camera/renderer/rig, so
// later steps are plain executeJavaScript instead of objectId juggling.
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
      // Everything inside the shells or behind the face, by part name. Not the
      // pixel-diff-clean set: this is the ceiling probe, degradation allowed.
      const INTERNAL = new Set(['seeed_bearing__configuration__22x16x4.stl','seeed_bearing__configuration_default.stl',
        'xl330.stl','pcb__raspberry_pi_zero_2_w.stl','elec_rpi_robot_hat_pcb.stl','np_f970.stl','m12_lens_holder.stl',
        'jaw_soft.stl','speaker.stl','motor_support.stl','banana_pcb_locker.stl','power_support.stl',
        'yaw_roll_motion.stl','upper_leg_rigidity_plate.stl','bearing_roll.stl']);
      const meshes = []; scene.traverse(o => { if (o.isMesh) meshes.push(o); });
      window.__abProbe = {
        mode: 'baseline',
        apply(mode) {
          // Always restore first so modes never stack.
          for (const m of meshes) { m.visible = true; m.geometry.setDrawRange(0, Infinity); }
          if (mode === 'hide-internal') for (const m of meshes) { if (INTERNAL.has(m.userData.meshName)) m.visible = false; }
          // 36 indices/vertices == 12 triangles: same object, same draw call,
          // same material and state setup, ~no geometry.
          if (mode === 'tiny-geom') for (const m of meshes) m.geometry.setDrawRange(0, 36);
          this.mode = mode; return this.info();
        },
        info() {
          const i = renderer.info.render;
          return { mode: this.mode, calls: i.calls, triangles: i.triangles, frame: i.frame,
                   visibleMeshes: meshes.filter(m => m.visible).length, totalMeshes: meshes.length };
        },
      };
      return window.__abProbe.info();
    }\`,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res.result.value;
})()`);
console.log(JSON.stringify(out));
close();
