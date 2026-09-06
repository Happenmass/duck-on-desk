// Reachy rig calibration and CCD adapted from Pollen Robotics' Apache-2.0
// reachy-mini-desktop-app GLTFRobot.tsx, commit 467ad30. See NOTICE.md.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const normalize = s => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
const axisZ = new THREE.Vector3(0, 0, 1);
const fix = new THREE.Quaternion().setFromAxisAngle(axisZ, Math.PI / 2);
const fixInv = fix.clone().invert();

function setupLeg(id, nodes, head) {
  const chain = ["001", "002", "003", "004"].map(s => nodes[normalize(`Neck.${id}.${s}`)]);
  const point = nodes[normalize(`Neck.loc.IK.${id}`)];
  if (chain.some(x => !x) || !point) throw new Error(`Reachy neck rig missing: ${id}`);
  const attach = point.getWorldPosition(new THREE.Vector3());
  const tip = new THREE.Object3D();
  tip.position.copy(chain[3].worldToLocal(attach.clone())); chain[3].add(tip);
  const target = new THREE.Object3D();
  target.position.copy(head.worldToLocal(attach.clone())); head.add(target);
  return { chain, tip, target, rest: chain.map(b => b.quaternion.clone()) };
}
const jointP = new THREE.Vector3(), tipP = new THREE.Vector3(), targetP = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), axis = new THREE.Vector3(), cross = new THREE.Vector3();
const worldQ = new THREE.Quaternion(), rotateQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
function solveLeg(leg) {
  leg.chain.forEach((b, i) => b.quaternion.copy(leg.rest[i]));
  leg.chain[0].updateWorldMatrix(false, true);
  leg.target.getWorldPosition(targetP);
  for (let iteration = 0; iteration < 12; iteration++) for (const index of [1, 3]) {
    const joint = leg.chain[index];
    leg.tip.getWorldPosition(tipP);
    if (tipP.distanceToSquared(targetP) < 1e-8) return;
    joint.getWorldPosition(jointP); joint.getWorldQuaternion(worldQ);
    v1.subVectors(tipP, jointP); v2.subVectors(targetP, jointP);
    if (index === 1) {
      axis.set(1, 0, 0).applyQuaternion(worldQ).normalize();
      v1.projectOnPlane(axis); v2.projectOnPlane(axis);
      if (v1.lengthSq() < 1e-12 || v2.lengthSq() < 1e-12) continue;
      v1.normalize(); v2.normalize();
      rotateQ.setFromAxisAngle(axis, Math.atan2(cross.crossVectors(v1, v2).dot(axis), v1.dot(v2)));
    } else rotateQ.setFromUnitVectors(v1.normalize(), v2.normalize());
    rotateQ.multiply(worldQ);
    joint.parent.getWorldQuaternion(parentQ);
    joint.quaternion.copy(parentQ.invert().multiply(rotateQ));
    joint.updateWorldMatrix(false, true);
  }
}

export async function loadReachyRig() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("./assets/reachy-mini/draco/");
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  let model;
  try { model = (await loader.loadAsync("./assets/reachy-mini/reachy_mini_viz.glb")).scene; }
  finally { draco.dispose(); }
  const root = new THREE.Group(); root.rotation.y = -Math.PI; root.scale.setScalar(0.5);
  model.rotation.x = -Math.PI / 2; root.add(model); root.updateMatrixWorld(true);
  const nodes = {};
  model.traverse(o => { if (o.name) nodes[normalize(o.name)] = o; });
  const body = nodes.core, head = nodes.core001, antL = nodes.antennal002, antR = nodes.antennar002;
  if (!body || !head || !antL || !antR) throw new Error("Reachy model has an incompatible skeleton");
  const restBody = body.quaternion.clone(), restL = antL.quaternion.clone(), restR = antR.quaternion.clone();
  const modelInv = model.matrixWorld.clone().invert();
  const bodyParent = modelInv.clone().multiply(body.parent.matrixWorld);
  const bodyAxis = axisZ.clone().applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(bodyParent).invert()).normalize();
  const headMatrix = modelInv.clone().multiply(head.matrixWorld);
  const headParentInv = modelInv.clone().multiply(head.parent.matrixWorld).invert();
  const restP = new THREE.Vector3(), restQ = new THREE.Quaternion(), restS = new THREE.Vector3();
  headMatrix.decompose(restP, restQ, restS);
  const legs = "ABCDEF".split("").map(id => setupLeg(id, nodes, head));
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
  return {
    root,
    setPose(pose) {
      body.quaternion.setFromAxisAngle(bodyAxis, pose.body_yaw).multiply(restBody);
      m.fromArray(pose.head).transpose().decompose(p, q, scale);
      p.applyQuaternion(fix).multiplyScalar(1.7).add(restP);
      p.z = THREE.MathUtils.clamp(p.z, restP.z - 0.085, restP.z + 0.044);
      q.premultiply(fix).multiply(fixInv).multiply(restQ);
      m.compose(p, q, restS).premultiply(headParentInv).decompose(head.position, head.quaternion, head.scale);
      root.updateMatrixWorld(true);
      for (const leg of legs) solveLeg(leg);
      antR.quaternion.copy(restR).multiply(q.setFromAxisAngle(axisZ, -pose.antennas[0]));
      antL.quaternion.copy(restL).multiply(q.setFromAxisAngle(axisZ, -pose.antennas[1]));
    },
    dispose() {
      model.traverse(o => {
        o.geometry?.dispose();
        for (const material of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
    },
  };
}
