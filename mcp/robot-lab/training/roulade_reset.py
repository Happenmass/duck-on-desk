"""Training-only stalled-ground timeout; active rolls and recovery get time."""
import math
import torch

RESET_RULES = dict(grace_seconds=0.8, stalled_seconds=1.0, low_height=0.08,
                   max_upright=0.5, quiet_angular_speed=0.8, quiet_linear_speed=0.08,
                   rotation_progress=math.radians(5), height_progress=0.005, upright_progress=0.1)


class StalledGroundReset:
    def __init__(self, cfg, env):
        self.rules = {**RESET_RULES, **cfg.params}
        self.stalled = torch.zeros(env.num_envs, device=env.device)
        self.rotation = torch.zeros_like(self.stalled)
        self.height = torch.zeros_like(self.stalled)
        self.upright = torch.zeros_like(self.stalled)
        self.fresh = torch.ones(env.num_envs, device=env.device, dtype=torch.bool)

    def reset(self, env_ids=None):
        ids = slice(None) if env_ids is None else env_ids
        self.stalled[ids] = 0
        self.fresh[ids] = True

    def update(self, *, age, dt, height, upright, rotation, angular_speed, linear_speed, supported):
        r = self.rules
        candidate = (age >= r['grace_seconds']) & supported & (height < r['low_height'])
        candidate &= (upright < r['max_upright']) & (angular_speed < r['quiet_angular_speed'])
        candidate &= linear_speed < r['quiet_linear_speed']
        progress = (rotation >= self.rotation + r['rotation_progress'])
        progress |= (height >= self.height + r['height_progress']) | (upright >= self.upright + r['upright_progress'])
        refresh = self.fresh | ~candidate | progress
        # Anchors move only after meaningful progress, so slow rises accumulate.
        self.rotation = torch.where(refresh, rotation, self.rotation)
        self.height = torch.where(refresh, height, self.height)
        self.upright = torch.where(refresh, upright, self.upright)
        self.stalled = torch.where(refresh, torch.zeros_like(self.stalled), self.stalled + dt)
        self.fresh.fill_(False)
        return candidate & (self.stalled + 1e-6 >= r['stalled_seconds'])

    def __call__(self, env):
        from mjlab_microduck.tasks import mdp
        robot = env.scene['robot']
        mdp._update_roulade_accum(env, robot)  # step-guarded, shared with official rewards
        data = robot.data
        q = data.root_link_quat_w
        return self.update(age=env.episode_length_buf * env.step_dt, dt=env.step_dt,
            height=data.root_link_pos_w[:, 2] - env.scene.terrain.env_origins[:, 2],
            upright=1 - 2 * (q[:, 1] ** 2 + q[:, 2] ** 2), rotation=env._roulade_max,
            angular_speed=data.root_link_ang_vel_b.norm(dim=-1),
            linear_speed=data.root_link_lin_vel_w.norm(dim=-1),
            supported=mdp._sensor_any_contact(env, 'robot_ground_contact'))


def install_stalled_reset(cfg):
    from mjlab.managers import TerminationTermCfg
    # Sampling timeout, not proof of an unrecoverable physical failure.
    cfg.terminations['roulade_stalled_ground'] = TerminationTermCfg(func=StalledGroundReset, time_out=True)
