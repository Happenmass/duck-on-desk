import pathlib
import unittest
import numpy as np
import mujoco
from action_environment import ActionEnvironments, HeadstandEnvironments, supported_headstand, STEPS

ASSETS = pathlib.Path(__file__).resolve().parents[3] / 'renderer/public/robot/mjlab'

class ActionEnvironmentTest(unittest.TestCase):
    def test_action_episode_starts_standing_and_uses_phase_commands(self):
        env = ActionEnvironments(ASSETS, 2, 2)
        obs = env.observe()
        self.assertEqual(obs.shape, (2, 61))
        np.testing.assert_allclose(obs[:, 48:51], [[1, 0, 0], [1, 0, 0]])
        self.assertTrue((env.state()['upright'] > .99).all())
        env.age[:] = STEPS // 2
        np.testing.assert_allclose(env.observe()[:, 48:51], [[-1, 0, .5], [-1, 0, .5]], atol=1e-6)
        env.reset(0)
        self.assertEqual(env.age[0], 0)
        np.testing.assert_allclose(env.observe()[0, 48:51], [1, 0, 0])

    def test_inversion_is_not_a_fall_termination_but_the_full_episode_is_bounded(self):
        env = ActionEnvironments(ASSETS, 1)
        env.data[0].qpos[2] = .4
        env.data[0].qpos[3:7] = [0, 1, 0, 0]
        mujoco.mj_forward(env.model, env.data[0])
        _, done, invalid = env.step(np.zeros((1, 14), dtype=np.float32))
        self.assertFalse(done[0]); self.assertFalse(invalid[0]); self.assertLess(env.state()['upright'][0], -.9)
        env.age[:] = STEPS - 1
        _, done, invalid = env.step(np.zeros((1, 14), dtype=np.float32))
        self.assertTrue(done[0]); self.assertFalse(invalid[0])

class HeadstandTest(unittest.TestCase):
    def test_real_standing_reset_is_not_headstand_and_exposes_support(self):
        env = HeadstandEnvironments(ASSETS, 2, 2)
        state = env.state()
        self.assertFalse(supported_headstand(state).any())
        for key in ['head_contact', 'feet_contact', 'body_contact', 'feet_height', 'feet_above_base',
                    'support_offset', 'angular_speed', 'horizontal_speed', 'joint_speed',
                    'joint_limit_margin', 'best_inversion', 'hold_seconds']:
            self.assertEqual(state[key].shape, (2,)); self.assertTrue(np.isfinite(state[key]).all())
        self.assertEqual(state['joint_positions'].shape, (2,14))
        np.testing.assert_allclose(state['joint_positions'][0], env.data[0].qpos[env.qadr])
        np.testing.assert_allclose(state['joint_velocities'][0], env.data[0].qvel[env.vadr])
        # An inverted airborne body must not be admitted as a supported headstand.
        for d in env.data:
            d.qpos[2] = 0.6; d.qpos[3:7] = [0, 1, 0, 0]; mujoco.mj_forward(env.model, d)
        self.assertTrue((env.state()['upright'] < -.9).all())
        self.assertFalse(supported_headstand(env.state()).any())

    def test_reward_is_time_independent_and_prefers_supported_hold_over_fall(self):
        import torch
        namespace = {}; exec(pathlib.Path(__file__).with_name('headstand-reward.py').read_text(), namespace)
        reward = namespace['reward_environment']
        state = {k:torch.tensor(v) for k,v in HeadstandEnvironments(ASSETS, 1).state().items()}
        action = torch.zeros(1,14)
        good = {**state, 'upright':torch.tensor([-1.]), 'head_contact':torch.ones(1),
                'feet_contact':torch.zeros(1), 'feet_height':torch.tensor([.2]),
                'body_contact':torch.zeros(1), 'feet_above_base':torch.tensor([.1]),
                'support_offset':torch.zeros(1), 'joint_speed':torch.zeros(1),
                'joint_limit_margin':torch.tensor([.2]),
                'angular_speed':torch.zeros(1), 'horizontal_speed':torch.zeros(1)}
        steady = reward(good,action,good)
        self.assertGreater(steady.item(), reward(state,action,state).item())
        self.assertGreater(steady.item(), reward(good,action,{**good,'head_contact':torch.zeros(1)}).item())
        self.assertEqual(steady.item(), reward(good,action,{**good,'phase':torch.ones(1)}).item())
        self.assertTrue(supported_headstand({k:v.numpy() for k,v in good.items()})[0])
        for key,value in [('head_contact',0),('feet_contact',1),('feet_height',.04),('upright',0),('angular_speed',2),('horizontal_speed',.2),
                          ('body_contact',1),('feet_above_base',.02),('support_offset',.08),('joint_speed',3),('joint_limit_margin',-.03)]:
            invalid = {k:v.numpy().copy() for k,v in good.items()};invalid[key][:]=value
            self.assertFalse(supported_headstand(invalid)[0],key)

    def test_progress_is_monotonic_and_resets_per_robot(self):
        env = HeadstandEnvironments(ASSETS, 2)
        env.data[0].qpos[2] = .6; env.data[0].qpos[3:7] = [0,1,0,0]
        mujoco.mj_forward(env.model, env.data[0])
        state, _, _ = env.step(np.zeros((2,14),np.float32))
        self.assertGreater(state['best_inversion'][0], .99)
        self.assertEqual(state['hold_seconds'][0], 0, 'Airborne inversion cannot start hold timer')
        before = state['best_inversion'].copy()
        env.state(); env.observe(); env.state()
        np.testing.assert_array_equal(before, env.best_inversion)
        env.reset(1); self.assertGreater(env.best_inversion[0], .99)
        env.reset(0); self.assertEqual(env.best_inversion[0], 0); self.assertEqual(env.holding[0], 0)

    def test_physical_supported_pose_can_hold_and_losing_support_resets_timer(self):
        # Feasibility fixture only: this deliberately starts inverted, not a learned flip.
        from environment import POSE, DT
        env = HeadstandEnvironments(ASSETS, 1)
        d=env.data[0]; d.qpos[2]=.28; d.qpos[3:7]=[np.cos(1.4),0,np.sin(1.4),0]
        d.qpos[env.qadr[5]]=.6; d.qvel[:]=0; mujoco.mj_forward(env.model,d)
        action=np.zeros((1,14),np.float32); action[0,5]=.6-POSE[5]
        expected=0.; longest=0.
        for _ in range(100):
            state,_,_=env.step(action)
            expected=expected+DT if supported_headstand(state)[0] else 0.
            self.assertAlmostEqual(float(state['hold_seconds'][0]),expected,places=6)
            longest=max(longest,expected)
        self.assertGreaterEqual(longest,.5,'New posture rules must recognize attainable real head support')
        d.qpos[2]+=.5; mujoco.mj_forward(env.model,d)
        state,_,_=env.step(action)
        self.assertEqual(state['head_contact'][0],0)
        self.assertEqual(state['hold_seconds'][0],0)

if __name__ == '__main__': unittest.main()
