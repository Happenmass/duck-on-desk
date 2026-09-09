'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
async function setup(t){
 const threeUrl=pathToFileURL(path.join(__dirname,'../node_modules/three/build/three.module.js')).href;
 const THREE=await import(threeUrl);
 const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');
 const source=fs.readFileSync(path.join(__dirname,'../renderer/src/runtime/lab-visuals.js'),'utf8').replace("from 'three'",`from '${threeUrl}'`);
 const {createLabVisuals}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const scene=new THREE.Scene(),placer=new THREE.Group(),root=new THREE.Group(),trunk=new THREE.Group();
 placer.rotation.y=-Math.PI/2;root.rotation.x=-Math.PI/2;scene.add(placer);placer.add(root);root.add(trunk);trunk.position.z=.12;
 const camera=new THREE.PerspectiveCamera(32,1,.02,20);camera.position.set(.36,.29,.5);
 const doc={addEventListener(){},removeEventListener(){}};
 const orbit=new OrbitControls(camera,{style:{},addEventListener(){},removeEventListener(){},getRootNode:()=>doc});orbit.target.set(0,.13,0);orbit.update();
 const visuals=createLabVisuals({scene,camera,orbit,rig:{placer,bodies:new Map([['trunk_base',trunk]]),joints:new Map()}});visuals.update();
 t.after(()=>{visuals.dispose();orbit.dispose();});return {THREE,trunk,camera,orbit,visuals};
}
function closeVector(a,b,message){assert.ok(a.distanceTo(b)<1e-9,message+': '+a.toArray()+' vs '+b.toArray());}
test('lab camera follows world-space travel and reset without changing the orbit offset or chasing step bounce',async t=>{
 const {THREE,trunk,camera,orbit,visuals}=await setup(t),before=camera.position.clone(),target=orbit.target.clone(),world=trunk.getWorldPosition(new THREE.Vector3());
 trunk.position.set(1.2,-.4,.16);visuals.update();
 const delta=trunk.getWorldPosition(new THREE.Vector3()).sub(world);delta.y=0;
 closeVector(camera.position,before.clone().add(delta),'Camera follows the actual rotated world coordinates');
 closeVector(orbit.target,target.clone().add(delta),'Orbit focus travels with the robot');
 closeVector(camera.position.clone().sub(orbit.target),before.clone().sub(target),'Viewing direction and distance stay unchanged');
 trunk.position.set(0,0,.12);visuals.update();closeVector(camera.position,before,'Reset returns framing to the starting position');
});
test('manual orbit, zoom, pan and camera presets stay relative to the walking robot',async t=>{
 const {THREE,trunk,camera,orbit,visuals}=await setup(t);
 camera.position.set(-.5,.4,.7);orbit.target.set(.07,.15,.02);orbit.update();
 const position=camera.position.clone(),target=orbit.target.clone(),world=trunk.getWorldPosition(new THREE.Vector3());
 trunk.position.x=2;visuals.update();const delta=trunk.getWorldPosition(new THREE.Vector3()).sub(world);delta.y=0;
 closeVector(camera.position,position.add(delta),'Follow preserves a manually chosen camera position');closeVector(orbit.target,target.add(delta),'Follow preserves manual panning');
 for(const view of ['home','front','side','top']){
  visuals.view(view);const offset=camera.position.clone().sub(orbit.target),old=orbit.target.clone();
  trunk.position.x+=.2;visuals.update();assert.ok(orbit.target.distanceTo(old)>.19,view+' keeps following');
  closeVector(camera.position.clone().sub(orbit.target),offset,view+' keeps its direction and zoom');
 }
});
