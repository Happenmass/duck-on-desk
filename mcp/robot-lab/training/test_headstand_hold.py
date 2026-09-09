import pathlib
import unittest
import numpy as np
import torch
from environment import POSE
from action_environment import HeadstandHoldEnvironments, HeadstandEnvironments, supported_headstand

ASSETS = pathlib.Path(__file__).resolve().parents[3] / 'renderer/public/robot/mjlab'


class HeadstandHoldTest(unittest.TestCase):
    def test_near_start_is_physical_seeded_and_not_credited_as_hold(self):
        a = HeadstandHoldEnvironments(ASSETS, 3, 2)
        b = HeadstandHoldEnvironments(ASSETS, 3, 2)
        np.testing.assert_array_equal(a.observe(), b.observe())
        self.assertTrue(supported_headstand(a.state()).all())
        self.assertTrue((a.state()['hold_seconds'] == 0).all())
        self.assertFalse(np.array_equal(a.data[0].qvel, a.data[1].qvel))
        np.testing.assert_allclose(a.previous[0], a.reference-POSE)
        before = a.data[1].qpos.copy()
        a.holding[:] = 20; a.reset(0)
        self.assertEqual(a.holding[0], 0); self.assertEqual(a.holding[1], 20)
        np.testing.assert_array_equal(before, a.data[1].qpos)
        self.assertTrue((HeadstandEnvironments(ASSETS, 1).state()['upright'] > .99).all())

    def test_dense_reward_has_signal_and_losing_pose_does_not_end_episode(self):
        env = HeadstandHoldEnvironments(ASSETS, 1, 2)
        ns = {}; exec(pathlib.Path(__file__).with_name('headstand-hold-reward.py').read_text(), ns)
        state = {k:torch.tensor(v) for k,v in env.state().items()}
        action = torch.tensor(env.previous.copy())
        good = ns['reward_environment'](state, action, state)
        self.assertGreater(good.item(), 1)
        tilted = {**state,'upright':torch.tensor([-.65]),'head_contact':torch.zeros(1)}
        self.assertGreater(ns['reward_components'](state, action, tilted)['posture'].item(), 0)
        self.assertLess(ns['reward_environment'](state, action, tilted).item(), good.item())
        lying = {**state,'upright':torch.zeros(1),'body_contact':torch.ones(1)}
        self.assertLess(ns['reward_environment'](state, action, lying).item(), 0)
        for device in ['cpu']+(['mps'] if torch.backends.mps.is_available() else []):
            actual = ns['reward_environment']({k:v.to(device) for k,v in state.items()},action.to(device),{k:v.to(device) for k,v in state.items()})
            torch.testing.assert_close(actual.cpu(), good)
        # No gravity disable, pose pin or external-force support is used.
        self.assertLess(env.model.opt.gravity[2], -9)
        env.age[:] = 30
        env.data[0].qpos[2] = .4; env.data[0].qpos[3:7] = [1,0,0,0]
        _,done,lost = env.step(env.previous.copy())
        self.assertFalse(done[0]); self.assertFalse(lost[0])
        self.assertEqual(env.age[0],31)
        self.assertGreater(env.data[0].qpos[2],.3)
        legacy = HeadstandHoldEnvironments(ASSETS,1,2,reset_on_pose_loss=True)
        legacy.age[:] = 30
        legacy.data[0].qpos[2] = .4; legacy.data[0].qpos[3:7] = [1,0,0,0]
        _,done,lost = legacy.step(legacy.previous.copy())
        self.assertTrue(done[0]); self.assertTrue(lost[0])

    def test_body_angle_reward_does_not_require_fixed_joint_pose(self):
        env = HeadstandHoldEnvironments(ASSETS, 1, 2)
        ns = {}; exec(pathlib.Path(__file__).with_name('headstand-hold-reward.py').read_text(), ns)
        state = {k:torch.tensor(v) for k,v in env.state().items()}
        action = torch.tensor(env.previous.copy())
        scores = [ns['reward_environment'](state, action, {**state, 'upright':torch.tensor([u])}).item()
                  for u in [-1., -.95, -.8, -.6, 0.]]
        self.assertTrue(all(a > b for a,b in zip(scores,scores[1:])))
        # Different articulation with the same measured balance must not lose
        # reward solely for deviating from the canned reset pose.
        a = ns['reward_environment'](state, action, {**state, 'reference_joint_error':torch.zeros(1)})
        b = ns['reward_environment'](state, action, {**state, 'reference_joint_error':torch.ones(1)*100})
        torch.testing.assert_close(a,b,rtol=0,atol=0)

    def test_fallen_robot_continues_past_old_time_limit_without_pose_teleport(self):
        env = HeadstandHoldEnvironments(ASSETS,1,2)
        saw_loss = False
        for step in range(800):
            state,done,invalid = env.step(np.zeros((1,14),dtype=np.float32))
            saw_loss |= bool(state['upright'][0]>-.6 or state['body_contact'][0]>0)
            self.assertFalse(invalid[0])
            self.assertFalse(done[0])
        self.assertTrue(saw_loss)
        self.assertEqual(env.age[0],800)
        self.assertAlmostEqual(env.data[0].time,16.,places=6)
        legacy_timeout=HeadstandHoldEnvironments(ASSETS,1,2,episode_steps=400)
        legacy_timeout.age[0]=399
        _,done,invalid=legacy_timeout.step(legacy_timeout.previous.copy())
        self.assertTrue(done[0]);self.assertFalse(invalid[0])

    def test_foot_touch_alone_is_not_penalized_but_body_contact_still_is(self):
        env=HeadstandHoldEnvironments(ASSETS,1,2)
        ns={};exec(pathlib.Path(__file__).with_name('headstand-hold-reward.py').read_text(),ns)
        s={k:torch.tensor(v) for k,v in env.state().items()}
        action=torch.tensor(env.previous.copy())
        score=ns['reward_environment'](s,action,s)
        touch=ns['reward_environment'](s,action,{**s,'feet_contact':torch.ones(1)})
        torch.testing.assert_close(touch,score)
        body=ns['reward_environment'](s,action,{**s,'body_contact':torch.ones(1)})
        self.assertLess(body.item(),score.item())
        # Touching the floor is allowed for recovery, not credited as a strict hold.
        self.assertFalse(supported_headstand({**env.state(),'feet_contact':np.ones(1)})[0])

    def test_thirty_second_timeout_and_disabled_timeout(self):
        env = HeadstandHoldEnvironments(ASSETS, 1, 2)
        for step in range(1500):
            _, done, invalid = env.step(np.zeros((1,14), dtype=np.float32))
            self.assertFalse(invalid[0], 'A time limit is truncation, not a fall penalty')
            self.assertEqual(bool(done[0]), step == 1499)
        self.assertAlmostEqual(env.data[0].time, 30., places=6)
        env.reset(0)
        self.assertEqual(env.age[0], 0)
        self.assertTrue(supported_headstand(env.state())[0])
        continuous = HeadstandHoldEnvironments(ASSETS, 1, 2, episode_steps=0)
        continuous.age[0] = 1500
        _, done, invalid = continuous.step(continuous.previous.copy())
        self.assertFalse(done[0]); self.assertFalse(invalid[0])

    def test_official_observations_keep_command_semantics_and_legacy_replay(self):
        env = HeadstandHoldEnvironments(ASSETS, 1, official_observations=True)
        np.testing.assert_array_equal(env.observe()[:,48:],np.zeros((1,13)))
        env.age[:] = 100
        np.testing.assert_array_equal(env.observe()[:,48:],np.zeros((1,13)))
        legacy = HeadstandHoldEnvironments(ASSETS, 1)
        self.assertEqual(legacy.observe()[0,48],1)


if __name__ == '__main__': unittest.main()
