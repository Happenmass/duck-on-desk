"""Atomic, local PPO checkpoints. New runs retain rollout and RNG state too."""
import hashlib
import json
import os
import pathlib
import random
import numpy as np
import mujoco
import torch

METHOD = 'official-full-finetune-v1'
RANDOM_METHOD = 'random-actor-ppo-v1'
COMPATIBLE_FIELDS = ('task', 'training_method', 'strategy', 'reward', 'environments',
                     'rollout_steps', 'target_speed', 'learning_rate', 'seed',
                     'training_device', 'inference_device', 'policy_initialization', 'ppo_profile', 'reset_on_pose_loss', 'hold_episode_steps')


def digest(file):
    return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()


def environment_state(env):
    spec = mujoco.mjtState.mjSTATE_INTEGRATION
    states = np.empty((len(env.data), mujoco.mj_stateSize(env.model, spec)))
    for row, data in zip(states, env.data):
        mujoco.mj_getState(env.model, data, row, spec)
    return {'physics': torch.from_numpy(states), 'rng': env.rng.bit_generator.state,
            'arrays': {key: torch.from_numpy(getattr(env, key).copy())
                       for key in ('previous', 'age', 'holding', 'best_inversion') if hasattr(env, key)}}


def restore_environment(env, state):
    spec = mujoco.mjtState.mjSTATE_INTEGRATION
    states = state['physics'].numpy()
    if states.shape != (len(env.data), mujoco.mj_stateSize(env.model, spec)):
        raise ValueError('Checkpoint simulation dimensions changed')
    for row, data in zip(states, env.data):
        mujoco.mj_setState(env.model, data, row, spec)
        mujoco.mj_forward(env.model, data)
        # mj_forward rebuilds contacts/sensors but can change integration warm starts.
        mujoco.mj_setState(env.model, data, row, spec)
    for key, value in state['arrays'].items():
        getattr(env, key)[:] = value.numpy()
    env.rng.bit_generator.state = state['rng']


def save(file, actor, critic, optimizer, env, config, iteration, steps, schedule_iterations, exploration=None):
    file = pathlib.Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    state = {'version': 2, 'actor': actor.state_dict(), 'critic': critic.state_dict(),
             'optimizer': optimizer.state_dict(), 'config': config,
             'iteration': iteration, 'environment_steps': steps,
             'schedule_iterations': schedule_iterations, 'model_hash': env.model_hash,
             'base_policy_sha256': digest(config['base_policy']),
             'environment': environment_state(env), 'torch_rng_state': torch.get_rng_state(),
             'python_rng_state': random.getstate(),
             'numpy_rng_state': json.dumps(np.random.get_state(), default=lambda x: x.tolist())}
    if exploration is not None: state['exploration'] = exploration.state_dict()
    device = next(actor.parameters()).device.type
    if device == 'mps': state['device_rng_state'] = torch.mps.get_rng_state()
    if device == 'cuda': state['device_rng_state'] = torch.cuda.get_rng_state()
    tmp = file.with_suffix('.tmp')
    try:
        torch.save(state, tmp)
        os.replace(tmp, file)
    finally:
        tmp.unlink(missing_ok=True)
    return {'iteration': iteration, 'environment_steps': steps, 'sha256': digest(file), 'version': 2}


def load(file, expected_hash, actor, critic, optimizer, env, config, exploration=None):
    if digest(file) != expected_hash:
        raise ValueError('Resume checkpoint hash mismatch')
    # Only tensor/primitive checkpoints, never arbitrary pickle classes.
    state = torch.load(file, map_location='cpu', weights_only=True)
    old = state['config']
    if old.get('training_method') not in (None, METHOD, RANDOM_METHOD):
        raise ValueError('Only matching official-architecture checkpoints can resume')
    for key in COMPATIBLE_FIELDS:
        # Earliest official exports lack this tag; strict actor state loading
        # below still rejects residual architectures (keys and layer sizes).
        if key == 'training_method' and key not in old: continue
        if key == 'hold_episode_steps' and old.get(key, 400) == config.get(key, 400): continue
        if key == 'reset_on_pose_loss' and old.get(key, True) == config.get(key, True): continue
        if key == 'ppo_profile' and old.get(key, 'legacy-v1') == config.get(key, 'legacy-v1'): continue
        if key == 'policy_initialization' and old.get(key, 'official') == config.get(key, 'official'): continue
        if old.get(key) != config.get(key):
            raise ValueError(f'Resume must preserve {key}')
    if state.get('model_hash', env.model_hash) != env.model_hash:
        raise ValueError('Checkpoint robot model changed')
    if (state.get('base_policy_sha256') or digest(old['base_policy'])) != digest(config['base_policy']):
        raise ValueError('Checkpoint official base policy changed')
    actor.load_state_dict(state['actor'], strict=True)
    critic.load_state_dict(state['critic'], strict=True)
    optimizer.load_state_dict(state['optimizer'])
    if exploration is not None:
        if 'exploration' not in state: raise ValueError('Checkpoint exploration state missing')
        exploration.load_state_dict(state['exploration'], strict=True)
    steps = int(state['environment_steps'])
    iteration = int(state.get('iteration', steps // (old['environments'] * old['rollout_steps'])))
    if iteration < 1 or steps != iteration * old['environments'] * old['rollout_steps']:
        raise ValueError('Invalid checkpoint progress')
    if 'environment' in state:
        restore_environment(env, state['environment'])
    torch.set_rng_state(state['torch_rng_state'])
    device = next(actor.parameters()).device.type
    if 'device_rng_state' in state:
        if device == 'mps': torch.mps.set_rng_state(state['device_rng_state'])
        if device == 'cuda': torch.cuda.set_rng_state(state['device_rng_state'])
    if 'python_rng_state' in state: random.setstate(state['python_rng_state'])
    if 'numpy_rng_state' in state:
        rng = json.loads(state['numpy_rng_state'])
        np.random.set_state((rng[0], np.array(rng[1], dtype=np.uint32), *rng[2:]))
    return iteration, steps, state.get('schedule_iterations', old['iterations']), 'environment' in state
