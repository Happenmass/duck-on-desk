"""Native MuJoCo counterpart to the ordinary-feet desktop runtime, without its assists."""
import json
import pathlib
import hashlib
import xml.etree.ElementTree as ET
import numpy as np
import mujoco

CONTRACT = json.loads(pathlib.Path(__file__).with_name('contract.json').read_text(encoding='utf-8'))
POSE = np.array(CONTRACT['default_pose'], dtype=np.float32)
JOINTS = CONTRACT['joints']
DT = CONTRACT['timestep'] * CONTRACT['decimation']


def build_model(asset_dir):
    asset_dir = pathlib.Path(asset_dir)
    source = (asset_dir / 'robot_allcollisions.xml').read_bytes()
    root = ET.fromstring(source)
    for parent in root.iter():
        for child in list(parent):
            if child.tag == 'geom' and child.get('class') == 'visual':
                parent.remove(child)
    used = {g.get('mesh') for g in root.iter('geom') if g.get('mesh')}
    asset = root.find('asset')
    blobs = {}
    for mesh in list(asset.findall('mesh')):
        name = mesh.get('name', pathlib.Path(mesh.get('file')).stem)
        if name not in used:
            asset.remove(mesh)
        else:
            name = mesh.get('file')
            blobs['assets/' + name] = (asset_dir / 'meshes' / name).read_bytes()
    ET.SubElement(root, 'option', timestep='0.005', integrator='implicitfast', iterations='10', ls_iterations='20')
    ET.SubElement(root.find('worldbody'), 'geom', name='desktop_floor', type='plane', size='0 0 0.05', pos='0 0 0')
    pose_map = dict(zip(JOINTS, POSE))
    joints = [pose_map.get(j.get('name'), 0) for body in root.iter('body') for j in body.findall('joint')]
    key = ET.SubElement(root, 'keyframe')
    ET.SubElement(key, 'key', name='STAND', qpos='0 0 0.12 1 0 0 0 ' + ' '.join(map(str, joints)), ctrl=' '.join(map(str, POSE)))
    model = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding='unicode'), blobs)
    fingerprint = hashlib.sha256(source + json.dumps(CONTRACT, sort_keys=True).encode())
    for name, blob in sorted(blobs.items()):
        fingerprint.update(name.encode()); fingerprint.update(blob)
    return model, fingerprint.hexdigest()


class Environments:
    def __init__(self, asset_dir, count, seed=0, target_speed=0.15):
        self.model, self.model_hash = build_model(asset_dir)
        self.data = [mujoco.MjData(self.model) for _ in range(count)]
        self.qadr = [self.model.joint(n).qposadr[0] for n in JOINTS]
        self.vadr = [self.model.joint(n).dofadr[0] for n in JOINTS]
        self.gyro = self.model.sensor('imu_ang_vel').adr[0]
        self.trunk = self.model.body('trunk_base').id
        self.rng = np.random.default_rng(seed)
        self.target = float(target_speed)
        self.previous = np.zeros((count, 14), dtype=np.float32)
        self.age = np.zeros(count, dtype=np.int32)
        for i in range(count): self.reset(i)

    def reset(self, i):
        d = self.data[i]
        mujoco.mj_resetDataKeyframe(self.model, d, self.model.key('STAND').id)
        # Deterministic, seed-controlled small perturbations for repeatable evaluation.
        d.qvel[self.vadr] = self.rng.normal(0, 0.005, 14)
        mujoco.mj_forward(self.model, d)
        self.previous[i].fill(0); self.age[i] = 0

    def state(self):
        rotations = np.array([d.xmat[self.trunk].reshape(3, 3) for d in self.data])
        return {
            'forward_velocity': np.array([d.sensordata[self.model.sensor('imu_lin_vel').adr[0]] for d in self.data], dtype=np.float32),
            'height': np.array([d.qpos[2] for d in self.data], dtype=np.float32),
            'upright': np.array([d.xmat[self.trunk].reshape(3, 3)[2, 2] for d in self.data], dtype=np.float32),
            'target_speed': np.full(len(self.data), self.target, dtype=np.float32),
            # Episodes start facing world +X; body-frame speed alone can reward walking in circles.
            'heading_error': np.arctan2(rotations[:, 1, 0], rotations[:, 0, 0]).astype(np.float32),
            'yaw_rate': np.array([d.sensordata[self.gyro + 2] for d in self.data], dtype=np.float32),
        }

    def observe(self):
        result = []
        for i, d in enumerate(self.data):
            gravity = d.xmat[self.trunk].reshape(3, 3).T @ np.array([0, 0, -1])
            commands = np.zeros(13, dtype=np.float32); commands[0] = self.target
            result.append(np.concatenate([d.sensordata[self.gyro:self.gyro+3], gravity, d.qpos[self.qadr]-POSE, d.qvel[self.vadr], self.previous[i], commands]))
        return np.asarray(result, dtype=np.float32)

    def step(self, actions):
        if actions.shape != (len(self.data), 14) or not np.isfinite(actions).all():
            raise ValueError('Policy action must be finite [environments,14]')
        for i, d in enumerate(self.data):
            d.ctrl[:] = POSE + actions[i]
            for _ in range(CONTRACT['decimation']): mujoco.mj_step(self.model, d)
        self.previous[:] = actions
        self.age += 1
        state = self.state()
        fallen = (state['height'] < 0.06) | (state['upright'] < 0.4)
        timeout = self.age >= 500
        done = fallen | timeout
        return state, done, fallen
