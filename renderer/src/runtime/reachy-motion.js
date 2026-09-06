import * as THREE from "three";

export function headPose({ x = 0, y = 0, z = 0, roll = 0, pitch = 0, yaw = 0 } = {}) {
  // SciPy Rotation.from_euler('xyz') uses extrinsic XYZ = Three intrinsic ZYX.
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, pitch, yaw, "ZYX"));
  m.setPosition(x, y, z);
  return m.transpose().toArray();
}
export const neutralPose = () => ({ head: headPose(), antennas: [-0.1745, 0.1745], body_yaw: 0 });

// SDK reachy_mini.py sleep transform (rounded upstream); normalize its
// rotation before interpolation so every command remains a rigid transform.
export function sleepPose() {
  const m = new THREE.Matrix4().set(
    0.911, 0.004, 0.413, -0.021,
    -0.004, 1, -0.001, 0.001,
    -0.413, -0.001, 0.911, -0.044,
    0, 0, 0, 1,
  );
  const q = new THREE.Quaternion().setFromRotationMatrix(m).normalize();
  m.makeRotationFromQuaternion(q).setPosition(-0.021, 0.001, -0.044);
  return { head: m.transpose().toArray(), antennas: [-3.05, 3.05], body_yaw: 0 };
}

export function sampleReachyMotion(file, seconds, glance = {}) {
  if (/sleeping/.test(file)) return sleepPose();
  if (/waking/.test(file)) return neutralPose();
  const sway = Math.sin(seconds * Math.PI);
  let z = 0.003 * Math.sin(seconds * Math.PI * 0.2), roll = 0, pitch = 0;
  let yaw = 0.1 * Math.sin(seconds * 0.45), ant = -0.1745 + 0.18 * sway, body_yaw = 0;
  if (/working|thinking|juggling|sweeping/.test(file)) {
    pitch = 0.09; yaw = 0.12 * Math.sin(seconds * 1.3); roll = 0.07 * Math.sin(seconds * 1.8);
    ant = 0.28 * Math.sin(seconds * 2.5); body_yaw = 0.05 * Math.sin(seconds * 0.8);
  } else if (/attention|notification|carrying/.test(file)) {
    z = 0.008; pitch = -0.12; yaw = 0; ant = 0.35 + 0.05 * sway;
  } else if (/error/.test(file)) {
    z = -0.012; pitch = 0.2; yaw = 0; ant = -0.35;

  } else {
    yaw += glance.yaw || 0; pitch += glance.pitch || 0;
  }
  return { head: headPose({ z, roll, pitch, yaw }), antennas: [ant, -ant], body_yaw };
}

export function blendPose(from, to, alpha) {
  const a = new THREE.Matrix4().fromArray(from.head).transpose();
  const b = new THREE.Matrix4().fromArray(to.head).transpose();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const bp = new THREE.Vector3(), bq = new THREE.Quaternion();
  a.decompose(p, q, s); b.decompose(bp, bq, new THREE.Vector3());
  // Daemon FK can contain small rounding/scale errors; commands are rigid.
  a.compose(p.lerp(bp, alpha), q.normalize().slerp(bq.normalize(), alpha).normalize(), s.set(1, 1, 1));
  return {
    head: a.transpose().toArray(),
    antennas: from.antennas.map((v, i) => v + (to.antennas[i] - v) * alpha),
    body_yaw: from.body_yaw + (to.body_yaw - from.body_yaw) * alpha,
  };
}


// The offline virtual animation only: a connected robot mirrors its own
// feedback, so nothing produced here is ever a physical target.
// A finite neutral -> sleep path also lets an interrupted sleep wake cleanly.
export function createReachyMotion() {
  let pose = neutralPose(), sleeping = false, stages = [], elapsed = 0, start = pose;
  function begin(next) { stages = next; elapsed = 0; start = pose; }
  return {
    resetPose(next) { pose = next; stages = []; elapsed = 0; start = next; },
    step(file, seconds, dt, glance = {}) {
      const nextSleeping = /sleeping/.test(file);
      if (nextSleeping !== sleeping) {
        sleeping = nextSleeping;
        begin(sleeping ? [{ pose: neutralPose(), duration: 1 }, { pose: sleepPose(), duration: 2 }] : [{ pose: neutralPose(), duration: 2 }]);
      }
      let target;
      const transitioning = stages.length > 0;
      if (stages.length) {
        elapsed += dt;
        const stage = stages[0], t = Math.min(1, elapsed / stage.duration);
        target = blendPose(start, stage.pose, t * t * (3 - 2 * t));
        if (t === 1) { stages.shift(); elapsed = 0; start = target; }
      } else target = sampleReachyMotion(file, seconds, glance);
      pose = transitioning || sleeping ? target : blendPose(pose, target, 1 - Math.exp(-3 * dt));
      return pose;
    },
  };
}
