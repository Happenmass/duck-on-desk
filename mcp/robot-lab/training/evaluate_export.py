"""Evaluate exported policies on held-out native physics, without desktop assists.

python evaluate_export.py POLICY.onnx BASE.onnx ASSETS report.json [steps] [seed]
Runs 12 independently seeded environments with no reset; fallen trajectories are failures.
"""
import json
import pathlib
import sys
import time
import numpy as np
import onnxruntime as ort
import mujoco
from environment import Environments, DT


def measure(policy, assets, steps=1000, seed=20001, count=12, target=.15, include_zero=False):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(policy, sess_options=options, providers=['CPUExecutionProvider'])
    env = Environments(assets, count, seed, target)
    if include_zero:
        # Include the exact stationary initial condition used by the desktop evaluator.
        env.data[0].qvel[:] = 0
        mujoco.mj_forward(env.model, env.data[0])
    start = np.array([d.qpos[:3].copy() for d in env.data])
    errors = np.zeros(count)
    velocity = np.zeros(count)
    upright = np.zeros(count)
    falls = np.zeros(count, dtype=bool)
    minimum_height = np.ones(count)
    max_abs_yaw = 0.0
    finite = True
    for _ in range(steps):
        observations = env.observe()
        # Desktop ONNX has a fixed batch of one; evaluate each environment independently.
        action = np.concatenate([session.run(['actions'], {'obs': row[None]})[0] for row in observations])
        state, _, fallen = env.step(action)
        finite = finite and all(np.isfinite(v).all() for v in state.values())
        errors += np.abs(state['forward_velocity'] - env.target)
        velocity += state['forward_velocity']
        upright += state['upright']
        minimum_height = np.minimum(minimum_height, state['height'])
        falls |= fallen
        rotations = np.array([d.xmat[env.trunk].reshape(3, 3) for d in env.data])
        max_abs_yaw = max(max_abs_yaw, float(np.abs(np.arctan2(rotations[:, 1, 0], rotations[:, 0, 0])).max()))
    final = np.array([d.qpos[:3].copy() for d in env.data])
    return {'steps': steps, 'seconds': steps * DT, 'seed': seed, 'environments': count, 'target_speed': target,
            'includes_zero_velocity_initial_state': include_zero,
            'finite': bool(finite), 'fall_rate': float(falls.mean()),
            'velocity_mae': float(errors.mean() / steps), 'velocity_mae_per_env': (errors / steps).tolist(),
            'mean_forward_velocity': float(velocity.mean() / steps),
            'mean_upright': float(upright.mean() / steps), 'minimum_height': float(minimum_height.min()),
            'max_abs_yaw_degrees': float(np.rad2deg(max_abs_yaw)),
            'world_displacement_per_env': (final - start).tolist()}


if __name__ == '__main__':
    candidate, base, assets, output = sys.argv[1:5]
    steps = int(sys.argv[5]) if len(sys.argv) > 5 else 1000
    seed = int(sys.argv[6]) if len(sys.argv) > 6 else 20001
    target = float(sys.argv[7]) if len(sys.argv) > 7 else .15
    started = time.monotonic()
    result = {'baseline': measure(base, assets, steps, seed, target=target), 'candidate': measure(candidate, assets, steps, seed, target=target)}
    result['relative_velocity_error_reduction'] = 1 - result['candidate']['velocity_mae'] / result['baseline']['velocity_mae']
    result['elapsed_seconds'] = time.monotonic() - started
    pathlib.Path(output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: v if not isinstance(v, dict) else {a: b for a, b in v.items() if not a.endswith('_per_env')} for k, v in result.items()}))
