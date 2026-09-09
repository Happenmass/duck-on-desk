import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildRig,loadKinematics,MODEL_DIR,setJoint} from './duck.js';
import {JOINT_NAMES,DEFAULT_POSE} from './constants.js';
import {materialHookFor,VARIANTS,DEFAULT_VARIANT} from './variants.js';

// A read-only view of native training poses. No physics, policy inference or training loop.
export async function createTrainingPreviewView(container) {
  const rig=await buildRig(await loadKinematics(`${MODEL_DIR}/kinematics.json`),{materialForMesh:materialHookFor(VARIANTS[DEFAULT_VARIANT])});
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.02,20);
  scene.background=new THREE.Color('#0b1720');scene.fog=new THREE.FogExp2('#0b1720',.8);
  rig.placer.rotation.y=-Math.PI/2;scene.add(rig.placer);
  const trunk=rig.bodies.get('trunk_base');trunk.position.set(0,0,.12);
  JOINT_NAMES.forEach((name,i)=>setJoint(rig,name,DEFAULT_POSE[i]));
  scene.add(new THREE.HemisphereLight('#e2f8ff','#243d4c',2.5));
  const key=new THREE.DirectionalLight('#ffffff',2);key.position.set(1,3,2);scene.add(key);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshBasicMaterial({color:'#0b1720'}));floor.rotation.x=-Math.PI/2;scene.add(floor);
  const grid=new THREE.GridHelper(8,80,'#335968','#193646');grid.position.y=.001;scene.add(grid);
  camera.position.set(.36,.29,.5);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(1.25,window.devicePixelRatio||1));renderer.toneMapping=THREE.ACESFilmicToneMapping;
  container.append(renderer.domElement);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,.13,0);orbit.minDistance=.3;orbit.maxDistance=2;orbit.update();
  let dirty=true,disposed=false,frame,lastRender=0;
  orbit.addEventListener('change',()=>dirty=true);
  const resize=new ResizeObserver(()=>{const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();dirty=true;});resize.observe(container);
  const point=new THREE.Vector3(),delta=new THREE.Vector3();
  function render(now){if(disposed)return;frame=requestAnimationFrame(render);if(!dirty||now-lastRender<1000/15)return;lastRender=now;dirty=false;renderer.render(scene,camera);container.dataset.renderedSequence=container.dataset.sequence||'0';}
  frame=requestAnimationFrame(render);
  return {
    reset(){trunk.position.set(0,0,.12);trunk.quaternion.set(0,0,0,1);JOINT_NAMES.forEach((name,i)=>setJoint(rig,name,DEFAULT_POSE[i]));camera.position.set(.36,.29,.5);orbit.target.set(0,.13,0);orbit.update();delete container.dataset.sequence;dirty=true;},
    setFrame(value){
      if(!Array.isArray(value?.root)||value.root.length!==7||!Array.isArray(value.joints)||value.joints.length!==JOINT_NAMES.length||![...value.root,...value.joints].every(Number.isFinite))return false;
      const q=value.root;trunk.position.set(q[0],q[1],q[2]);trunk.quaternion.set(q[4],q[5],q[6],q[3]);
      JOINT_NAMES.forEach((name,i)=>setJoint(rig,name,value.joints[i]));rig.placer.updateWorldMatrix(true,true);
      trunk.getWorldPosition(point);point.y=Math.max(.13,point.y);delta.copy(point).sub(orbit.target);camera.position.add(delta);orbit.target.copy(point);orbit.update();
      container.dataset.sequence=value.sequence;container.dataset.iteration=value.iteration;dirty=true;return true;
    },
    dispose(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();orbit.dispose();
      const materials=new Set();rig.placer.traverse(o=>{if(o.material)materials.add(o.material);});for(const material of materials)material.dispose();
      // Rig geometries are shared with the control view's asset cache.
      floor.geometry.dispose();floor.material.dispose();grid.geometry.dispose();grid.material.dispose();
      renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();delete container.dataset.sequence;delete container.dataset.renderedSequence;
    },
  };
}
