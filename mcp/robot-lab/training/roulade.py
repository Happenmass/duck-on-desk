"""Official Roulade adapter: walking warm-start and standing-only evaluation."""
import copy
import json
import math
import os
import pathlib
import torch
import random
import numpy as np
from contextlib import contextmanager


@contextmanager
def isolated_rng():
    python_state, numpy_state = random.getstate(), np.random.get_state()
    try:
        with torch.random.fork_rng(), torch.inference_mode(False), torch.no_grad():
            yield
    finally:
        random.setstate(python_state)
        np.random.set_state(numpy_state)

class RouladeCancelled(Exception):
    pass


def initialize_from_walk(model, filename):
    from policy import BasePolicy
    source = BasePolicy(filename).to(next(model.parameters()).device).eval()
    if not isinstance(model.obs_normalizer, torch.nn.Identity):
        raise ValueError('Walking warm start requires disabled actor online normalization')
    targets = [m for m in model.mlp.modules() if isinstance(m, torch.nn.Linear)]
    origins = [m for m in source.net.modules() if isinstance(m, torch.nn.Linear)]
    if len(targets) != len(origins):
        raise ValueError('Walking actor architecture mismatch')
    with torch.no_grad():
        for target, original in zip(targets, origins):
            target.weight.copy_(original.weight)
            target.bias.copy_(original.bias)
        # Fold the exact ONNX normalization into the first affine layer.
        targets[0].weight.div_(source.scale.reshape(-1))
        targets[0].bias.sub_(targets[0].weight @ source.mean.reshape(-1))
        x = torch.linspace(-1, 1, 61 * 32, device=targets[0].weight.device).reshape(32, 61)
        error = (model.as_onnx(False)(x) - source(x)).abs().max().item()
    if error > .002:
        raise ValueError(f'Walking warm-start parity failed: {error}')
    return error


class RouladeEvaluation:
    def __init__(self, cfg, device, output, view_factory):
        from mjlab.envs import ManagerBasedRlEnv
        from mjlab.rl import RslRlVecEnvWrapper
        from mjlab.sensor import ContactMatch, ContactSensorCfg
        cfg = copy.deepcopy(cfg)
        cfg.scene.num_envs = 20
        cfg.seed = 1001
        cfg.episode_length_s = 11.0  # record ten seconds without an automatic reset
        cfg.curriculum = {}
        cfg.terminations.pop('roulade_stalled_ground', None)
        cfg.events['set_roulade_state'].params.update(standing_prob=1.0, midroll_prob=0.0,
                                                     forward_vel_range=(0.0, 0.0))
        cfg.scene.sensors = (*cfg.scene.sensors, *(ContactSensorCfg(
            name=f'eval_{side}_foot', primary=ContactMatch(mode='geom', pattern=f'{side}_foot_collision', entity='robot'),
            secondary=ContactMatch(mode='body', pattern='terrain'), fields=('found',), reduce='none', num_slots=1)
            for side in ('left', 'right')))
        self.env = RslRlVecEnvWrapper(ManagerBasedRlEnv(cfg=cfg, device=device))
        self.output = pathlib.Path(output)
        self.view_factory = view_factory

    def run(self, actor, iteration, preview=None, stage='candidate', save=False, stop=lambda: False):
        from environment import CONTRACT
        from mjlab_microduck.tasks import mdp
        env = self.env
        actor = copy.deepcopy(actor).to(env.device).eval()
        # Isolate evaluation randomness from PPO (including reset randomization).
        with isolated_rng():
            env.seed(1001)
            obs, _ = env.reset()
            raw = env.unwrapped
            robot = raw.scene['robot']
            view = self.view_factory(env, CONTRACT['joints'])
            held = torch.zeros(20, device=env.device)
            best = held.clone()
            valid = torch.ones(20, dtype=torch.bool, device=env.device)
            progress = held.clone()
            frames = []
            def frame():
                d = view.data[0]
                frames.append({'root': d.qpos[:7].tolist(), 'joints': d.qpos[7:].tolist()})
            frame()
            for step in range(500):
                if stop():
                    raise RouladeCancelled()
                with torch.no_grad():
                    obs, _, done, _ = env.step(actor(obs['actor']))
                valid &= ~done.bool()  # no reset may count as a successful trick
                mdp._update_roulade_accum(raw, robot)
                progress = torch.maximum(progress, raw._roulade_max)
                q = robot.data.root_link_quat_w
                upright = 1 - 2 * (q[:, 1] ** 2 + q[:, 2] ** 2)
                feet = mdp._sensor_any_contact(raw, 'eval_left_foot') & mdp._sensor_any_contact(raw, 'eval_right_foot')
                # A full supported forward turn, top-of-head latch, then quiet standing.
                standing = (raw._roulade_max >= math.radians(350)) & raw._roulade_head_latch
                standing &= (upright > math.cos(math.radians(15))) & (robot.data.root_link_pos_w[:, 2] > .10)
                standing &= (robot.data.root_link_ang_vel_b.norm(dim=-1) < 1.0) & feet
                standing &= robot.data.root_link_lin_vel_w[:, :2].norm(dim=-1) < .1
                held = torch.where(standing & valid, held + raw.step_dt, torch.zeros_like(held))
                # Acceptance is within the official five-second episode; the rest is inspection.
                if step < 250:
                    best = torch.maximum(best, held)
                frame()
                if preview:
                    preview.publish(view, iteration, stage)
            successes = (best >= 1.0) & valid
            result = {'goal': 'roulade', 'evaluation_version': 'roulade-v1', 'environments': 20,
                      'seconds': 10, 'acceptance_seconds': 5, 'success_count': int(successes.sum()),
                      'success': bool(successes.sum() >= 18), 'max_hold_seconds': float(best.max()),
                      'mean_progress_degrees': float(progress.mean() * 180 / math.pi)}
            if save:
                directory = self.output / 'previews'
                directory.mkdir(parents=True, exist_ok=True)
                target = directory / f'iteration-{iteration}.json'
                temporary = target.with_suffix('.json.tmp')
                temporary.write_text(json.dumps({'version': 1, 'iteration': iteration, 'duration': 10,
                    'dt': raw.step_dt, 'seed': 1001, 'frames': frames}, allow_nan=False), encoding='utf-8')
                os.replace(temporary, target)
            return result

    def close(self):
        self.env.close()
