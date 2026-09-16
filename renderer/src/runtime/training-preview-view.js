import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildRig,loadKinematics,MODEL_DIR,setJoint} from './duck.js';
import {JOINT_NAMES,DEFAULT_POSE} from './constants.js';
import {materialHookFor,VARIANTS,DEFAULT_VARIANT} from './variants.js';
import {poseTweenProgress} from './pose-interpolation.js';

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
  let dirty=true,disposed=false,frame,lastRender=performance.now(),startedAt=lastRender,durationMs=100,animating=false,lastCapturedAt=null;
  const current={root:[0,0,.12,1,0,0,0],joints:Array.from(DEFAULT_POSE)};
  const from={root:[...current.root],joints:[...current.joints]};
  const target={root:[...current.root],joints:[...current.joints]};
  const fromQuaternion=new THREE.Quaternion(),targetQuaternion=new THREE.Quaternion(),renderQuaternion=new THREE.Quaternion();
  orbit.addEventListener('change',()=>dirty=true);
  const resize=new ResizeObserver(()=>{const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();dirty=true;});resize.observe(container);
  const point=new THREE.Vector3(),delta=new THREE.Vector3();
  function applyPose(now){
    const t=animating?poseTweenProgress(now,startedAt,durationMs):1;
    for(let i=0;i<3;i++)current.root[i]=THREE.MathUtils.lerp(from.root[i],target.root[i],t);
    fromQuaternion.set(from.root[4],from.root[5],from.root[6],from.root[3]);
    targetQuaternion.set(target.root[4],target.root[5],target.root[6],target.root[3]);
    renderQuaternion.copy(fromQuaternion).slerp(targetQuaternion,t).normalize();
    current.root[3]=renderQuaternion.w;current.root[4]=renderQuaternion.x;current.root[5]=renderQuaternion.y;current.root[6]=renderQuaternion.z;
    trunk.position.set(current.root[0],current.root[1],current.root[2]);trunk.quaternion.copy(renderQuaternion);
    JOINT_NAMES.forEach((name,i)=>{current.joints[i]=THREE.MathUtils.lerp(from.joints[i],target.joints[i],t);setJoint(rig,name,current.joints[i]);});
    rig.placer.updateWorldMatrix(true,true);trunk.getWorldPosition(point);point.y=Math.max(.13,point.y);
    delta.copy(point).sub(orbit.target);camera.position.add(delta);orbit.target.copy(point);orbit.update();
    animating=t<1;
  }
  function render(now){if(disposed)return;frame=requestAnimationFrame(render);if(!dirty&&!animating)return;const elapsed=now-lastRender;if(elapsed<1000/60*.75)return;lastRender=now;applyPose(now);dirty=false;renderer.render(scene,camera);container.dataset.renderedSequence=container.dataset.sequence||'0';}
  frame=requestAnimationFrame(render);
  return {
    reset(){current.root.splice(0,7,0,0,.12,1,0,0,0);current.joints.splice(0,current.joints.length,...DEFAULT_POSE);from.root.splice(0,7,...current.root);target.root.splice(0,7,...current.root);from.joints.splice(0,from.joints.length,...current.joints);target.joints.splice(0,target.joints.length,...current.joints);animating=false;lastCapturedAt=null;trunk.position.set(0,0,.12);trunk.quaternion.set(0,0,0,1);JOINT_NAMES.forEach((name,i)=>setJoint(rig,name,DEFAULT_POSE[i]));camera.position.set(.36,.29,.5);orbit.target.set(0,.13,0);orbit.update();delete container.dataset.sequence;dirty=true;},
    setFrame(value, {immediate=false}={}){
      if(!Array.isArray(value?.root)||value.root.length!==7||!Array.isArray(value.joints)||value.joints.length!==JOINT_NAMES.length||![...value.root,...value.joints].every(Number.isFinite))return false;
      from.root.splice(0,7,...current.root);from.joints.splice(0,from.joints.length,...current.joints);
      target.root.splice(0,7,...value.root);target.joints.splice(0,target.joints.length,...value.joints);
      const sourceInterval=lastCapturedAt===null?100:value.captured_at-lastCapturedAt;
      durationMs=Math.min(160,Math.max(60,Number.isFinite(sourceInterval)?sourceInterval:100));lastCapturedAt=value.captured_at;
      startedAt=performance.now();animating=!immediate;container.dataset.sequence=value.sequence;container.dataset.iteration=value.iteration;dirty=true;return true;
    },
    dispose(){disposed=true;cancelAnimationFrame(frame);resize.disconnect();orbit.dispose();
      const materials=new Set();rig.placer.traverse(o=>{if(o.material)materials.add(o.material);});for(const material of materials)material.dispose();
      // Rig geometries are shared with the control view's asset cache.
      floor.geometry.dispose();floor.material.dispose();grid.geometry.dispose();grid.material.dispose();
      renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();delete container.dataset.sequence;delete container.dataset.renderedSequence;
    },
  };
}
