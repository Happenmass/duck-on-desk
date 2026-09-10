"""Phase-conditioned 8 s action episodes, always reset from STAND.

Inversion is intentional here. Never use the walking fall penalty/early reset.
"""
import numpy as np
import torch
import json
import pathlib
import mujoco
from environment import Environments, CONTRACT, DT, JOINTS, POSE

DURATION = 8.0
STEPS = round(DURATION / DT)
HOLD_REFERENCE = json.loads(pathlib.Path(__file__).with_name('headstand-hold.json').read_text(encoding='utf-8'))


class ActionEnvironments(Environments):
    def __init__(self, asset_dir, count, seed=0, target_speed=0, official_observations=False):
        self.official_observations = official_observations
        super().__init__(asset_dir, count, seed, 0)
        self.floor = self.model.geom('desktop_floor').id

    def state(self):
        state = super().state()
        state.update(phase=(self.age / STEPS).astype(np.float32),
                     ground_contact=np.array([any(c.geom1 == self.floor or c.geom2 == self.floor for c in d.contact) for d in self.data], dtype=np.float32),
                     previous_action=self.previous.copy())
        return state

    def observe(self):
        obs = super().observe()
        if self.official_observations:
            return obs
        phase = self.age / STEPS
        obs[:, 48] = np.cos(2 * np.pi * phase)
        obs[:, 49] = np.sin(2 * np.pi * phase)
        obs[:, 50] = phase
        return obs

    def step(self, actions):
        state, _, _ = super().step(actions)
        invalid = np.array([not np.isfinite(d.qpos).all() or not np.isfinite(d.qvel).all() for d in self.data])
        return state, invalid | (self.age >= STEPS), invalid



class HeadstandEnvironments(ActionEnvironments):
    """Standing starts; measure whole-body posture and uninterrupted support."""
    def __init__(self, asset_dir, count, seed=0, target_speed=0, official_observations=False):
        self.best_inversion = np.zeros(count, dtype=np.float32)
        self.holding = np.zeros(count, dtype=np.int32)
        super().__init__(asset_dir, count, seed, target_speed, official_observations)
        self.head = self.model.body('jaw_soft').id
        self.feet = [self.model.geom(n).id for n in ('left_foot_collision', 'right_foot_collision')]
        self.limits = np.array([self.model.joint(n).range for n in JOINTS])

    def reset(self, i):
        super().reset(i)
        self.best_inversion[i] = 0
        self.holding[i] = 0

    def state(self):
        state = super().state()
        head_contact = []; feet_contact = []; body_contact = []; offsets = []
        for d in self.data:
            contacts = [c for c in d.contact if (c.geom1 == self.floor or c.geom2 == self.floor) and c.dist <= 0.001]
            touching = [c.geom2 if c.geom1 == self.floor else c.geom1 for c in contacts]
            head_contact.append(any(self.model.geom_bodyid[g] == self.head for g in touching))
            feet_contact.append(any(g in self.feet for g in touching))
            body_contact.append(any(g not in self.feet and self.model.geom_bodyid[g] != self.head for g in touching))
            points = [c.pos[:2] for c, g in zip(contacts, touching) if self.model.geom_bodyid[g] == self.head]
            # Contact centroid is a geometric proxy, not a measured force balance.
            support = np.mean(points, axis=0) if points else d.xipos[self.head, :2]
            offsets.append(np.linalg.norm(d.subtree_com[self.trunk, :2] - support))
        positions = np.asarray([d.qpos[self.qadr] for d in self.data], dtype=np.float32)
        velocities = np.asarray([d.qvel[self.vadr] for d in self.data], dtype=np.float32)
        margin = np.minimum(positions-self.limits[:, 0], self.limits[:, 1]-positions) / (self.limits[:, 1]-self.limits[:, 0])
        state.update(head_contact=np.asarray(head_contact, dtype=np.float32),
                     feet_contact=np.asarray(feet_contact, dtype=np.float32),
                     body_contact=np.asarray(body_contact, dtype=np.float32),
                     support_offset=np.asarray(offsets, dtype=np.float32),
                     feet_height=np.asarray([min(d.geom_xpos[g, 2] for g in self.feet) for d in self.data], dtype=np.float32),
                     angular_speed=np.asarray([np.linalg.norm(d.sensordata[self.gyro:self.gyro+3]) for d in self.data], dtype=np.float32),
                     horizontal_speed=np.asarray([np.linalg.norm(d.qvel[:2]) for d in self.data], dtype=np.float32),
                     joint_positions=positions, joint_velocities=velocities,
                     joint_speed=np.sqrt(np.mean(velocities**2, axis=-1)),
                     joint_limit_margin=margin.min(axis=-1).astype(np.float32),
                     best_inversion=self.best_inversion.copy(),
                     hold_seconds=(self.holding * DT).astype(np.float32))
        state['feet_above_base'] = state['feet_height'] - state['height']
        return state

    def step(self, actions):
        state, done, invalid = super().step(actions)
        self.best_inversion = np.maximum(self.best_inversion, ((1-state['upright'])/2).clip(0, 1))
        self.holding = np.where(supported_headstand(state) & ~invalid, self.holding + 1, 0)
        state['best_inversion'] = self.best_inversion.copy()
        state['hold_seconds'] = (self.holding * DT).astype(np.float32)
        return state, done, invalid


def head_down(state):
    """Lesson 2 target: trunk rotated head-down with the head centre on the floor.

    Deliberately weaker than supported_headstand: the feet may touch, because the
    feet are what rights the body, and there is no angular-speed ceiling, because
    balancing on a single head contact point requires continuous correction.
    """
    return (state['upright'] < -0.7) & (state['head_contact'] > 0)


def supported_headstand(state):
    return ((state['upright'] < -0.8) & (state['head_contact'] > 0)
            & (state['feet_contact'] == 0) & (state['feet_height'] > 0.08)
            & (state['body_contact'] == 0) & (state['feet_above_base'] > 0.04)
            & (state['support_offset'] < 0.04) & (state['joint_limit_margin'] >= -0.02)
            & (state['angular_speed'] < 1.0) & (state['horizontal_speed'] < 0.1)
            & (state['joint_speed'] < 2.0))

class HeadstandHoldEnvironments(HeadstandEnvironments):
    """Balance practice starts supported. Reset is not credited as learned entry."""
    reference = np.asarray(HOLD_REFERENCE['joint_targets'], dtype=np.float32)

    def __init__(self, *args, reset_on_pose_loss=False, episode_steps=1500, random_start=False, **kwargs):
        self.reset_on_pose_loss = reset_on_pose_loss
        self.episode_steps = episode_steps
        self.random_start = random_start
        count = args[1] if len(args) > 1 else kwargs['count']
        self.armed = np.zeros(count, dtype=bool)
        self.recovered = np.zeros(count, dtype=np.float32)
        super().__init__(*args, **kwargs)

    def reset(self, i):
        super().reset(i)
        self.armed[i] = False; self.recovered[i] = 0
        d = self.data[i]
        d.qpos[:3] = HOLD_REFERENCE['root_position']
        d.qpos[3:7] = HOLD_REFERENCE['root_quaternion']
        d.qpos[self.qadr] = HOLD_REFERENCE['joint_positions']
        d.qvel[:] = 0
        d.qvel[3:6] = self.rng.normal(0, 0.03, 3)
        d.qvel[self.vadr] = self.rng.normal(0, 0.01, len(JOINTS))
        d.ctrl[:] = self.reference
        self.previous[i] = self.reference - POSE
        mujoco.mj_forward(self.model, d)
        if self.random_start:
            # Reference state initialization. Without it the only two states ever
            # sampled are "balanced at the top" and "flat on the floor", and the
            # small corrections in between -- the easy part of the recovery -- are
            # never practised. Evaluation keeps the fixed start so runs compare.
            d.qvel[3:6] = self.rng.normal(0, 0.6, 3)
            for _ in range(int(self.rng.integers(0, 46))):
                for _ in range(CONTRACT['decimation']): mujoco.mj_step(self.model, d)
            mujoco.mj_forward(self.model, d)

    def state(self):
        state = super().state()
        state['reference_joint_error'] = np.mean((state['joint_positions']-self.reference)**2, axis=-1)
        state['recovered'] = self.recovered.copy()
        return state

    def step(self, actions):
        state, done, invalid = super().step(actions)
        # One pulse on the step the duck arrives back at head-down support after
        # having been clearly down. A pose reward alone always has a cheap static
        # solution; this is the only term a duck that folds up and freezes cannot
        # collect. The wide hysteresis band means it must genuinely fall and
        # genuinely come back -- a wobble across one threshold is not a recovery.
        back = head_down(state) & (state['height'] > 0.06)
        self.recovered = (back & self.armed).astype(np.float32)
        self.armed = (self.armed | (state['upright'] > -0.2)) & ~back
        state['recovered'] = self.recovered.copy()
        # Old checkpoints retain their original early termination. New training
        # can push off the floor and recover without teleporting to the start.
        lost = self.reset_on_pose_loss & (self.age >= 25) & ((state['upright'] > -0.6) | (state['body_contact'] > 0))
        timeout = (self.age >= self.episode_steps) if self.episode_steps else np.zeros(len(self.data), dtype=bool)
        return state, timeout | invalid | lost, invalid | lost


def evaluate_action(actor, asset_dir, device, target, seed, steps=STEPS, preview=None, stage='evaluation', iteration=0, hold_only=False, near_start=False, official_observations=False):
    env = (HeadstandHoldEnvironments if near_start else HeadstandEnvironments if hold_only else ActionEnvironments)(asset_dir, 3, seed, official_observations=official_observations)
    inverted = np.zeros(3); hops = np.zeros(3, dtype=int); air = np.zeros(3, dtype=int)
    holding = np.zeros(3, dtype=int); longest = np.zeros(3, dtype=int)
    standing = np.zeros(3, dtype=int); finite = np.ones(3, dtype=bool); frames = []
    down = np.zeros(3, dtype=int); lying = np.zeros(3, dtype=int)
    recoveries = np.zeros(3, dtype=int); armed = np.zeros(3, dtype=bool)
    bout = np.zeros(3, dtype=int); longest_bout = np.zeros(3, dtype=int)
    actor.eval()
    for step in range(STEPS):
        with torch.inference_mode(): action = actor(torch.tensor(env.observe(), device=device)).cpu().numpy()
        state, _, _ = env.step(action)
        finite &= np.asarray([np.isfinite(d.qpos).all() and np.isfinite(d.qvel).all() for d in env.data])
        if hold_only:
            holding = np.where(supported_headstand(state), holding + 1, 0)
            longest = np.maximum(longest, holding)
        if near_start:
            # Cycle scoring: time spent head-down, and how often it comes back.
            # The hysteresis band means a wobble across the line is not a recovery.
            here = head_down(state)
            recoveries += here & armed
            armed = (armed | (state['upright'] > -0.2)) & ~here
            down += here; lying += state['body_contact'] > 0
            bout = np.where(here, bout + 1, 0); longest_bout = np.maximum(longest_bout, bout)
        upside = state['upright'] < -0.7
        inverted += upside * DT
        for i in range(3):
            if upside[i] and not state['ground_contact'][i]: air[i] += 1
            else:
                if upside[i] and state['ground_contact'][i] and air[i] >= 2: hops[i] += 1
                air[i] = 0
            d = env.data[i]
            stable = state['upright'][i] > 0.85 and state['height'][i] > 0.085 and np.linalg.norm(d.qvel[:2]) < 0.08
            standing[i] = standing[i] + 1 if stable else 0
        if preview: preview.publish(env, iteration, stage)
        if step % 5 == 0: frames.append(env.data[0].qpos.tolist())
    if near_start:
        # Provisional thresholds, calibrated against a CEM-MPC planner that reaches
        # 88% head-down time and 0% lying on this model. Not a validated RL result.
        success = finite & (down >= .30*STEPS) & (lying <= .60*STEPS)
    elif hold_only:
        success = finite & (holding >= 100)
    else:
        success = finite & (inverted >= 0.4) & (hops >= 1) & (standing >= 20)
    return {'goal':'headstand-hold' if near_start else 'headstand' if hold_only else 'dance', 'evaluation_version':'headstand-cycle-v1' if near_start else 'headstand-posture-v2' if hold_only else 'dance-v1', 'initialization':'near-headstand' if near_start else 'standing', 'hold_seconds':float(holding.min() * DT),
            'longest_hold_seconds':float(longest.min() * DT), 'steps':STEPS, 'seconds':DURATION, 'environments':3, 'success':bool(success.all()),
            'success_rate':float(success.mean()), 'inverted_seconds':float(inverted.min()),
            'inverted_hops':int(hops.min()), 'standing':bool((standing >= 20).all()),
            'head_down_percent':float(100*down.min()/STEPS), 'lying_percent':float(100*lying.max()/STEPS),
            'recoveries':int(recoveries.min()), 'longest_head_down_seconds':float(longest_bout.min()*DT),
            'nonFinite':not bool(finite.all()), 'frames':frames}


def evaluate_headstand(*args, **kwargs):
    return evaluate_action(*args, **kwargs, hold_only=True)


def evaluate_headstand_hold(*args, **kwargs):
    return evaluate_action(*args, **kwargs, hold_only=True, near_start=True)
