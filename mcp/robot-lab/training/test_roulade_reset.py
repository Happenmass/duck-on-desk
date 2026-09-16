import unittest
from unittest.mock import patch
from types import SimpleNamespace
import torch
from roulade_reset import StalledGroundReset
from roulade_reset import install_stalled_reset


class Tests(unittest.TestCase):
    def setUp(self):
        self.term = StalledGroundReset(SimpleNamespace(params={}), SimpleNamespace(num_envs=2, device='cpu'))

    def step(self, age=2., height=.04, upright=0., rotation=0., angular_speed=0., linear_speed=0., supported=True):
        values = locals().copy(); values.pop('self')
        return self.term.update(dt=.02, **{k: torch.full((2,), v) for k, v in values.items()})

    def test_still_ground_times_out_and_per_environment_reset_clears_history(self):
        for _ in range(50):
            self.assertFalse(self.step().any())
        self.assertTrue(self.step().all())
        self.term.reset(torch.tensor([0]))
        self.assertEqual(self.step().tolist(), [False, True])

    def test_grace_standing_airborne_rotation_and_rising_are_not_stalls(self):
        for kwargs in [dict(age=.5), dict(height=.115,upright=1.), dict(supported=False), dict(angular_speed=1.), dict(linear_speed=.1)]:
            self.term.reset()
            for _ in range(100):
                self.assertFalse(self.step(**kwargs).any())
        for kind, increment in [('rotation',.002),('height',.0002),('upright',.003)]:
            self.term.reset()
            for i in range(100):
                self.assertFalse(self.step(**{kind:(.04 if kind=='height' else 0)+i*increment}).any())

    def test_recovery_interrupts_stall_and_backward_rotation_does_not_count(self):
        for _ in range(40):
            self.step()
        self.assertFalse(self.step(angular_speed=2.).any())
        for _ in range(40):
            self.assertFalse(self.step().any())
        self.term.reset()
        for i in range(52):
            result = self.step(rotation=-i*.01)
        self.assertTrue(result.all())

    def test_real_termination_manager_dispatch_reset_and_timeout_semantics(self):
        from mjlab.managers.termination_manager import TerminationManager
        import mjlab_microduck.tasks
        class Scene(dict):
            terrain = SimpleNamespace(env_origins=torch.zeros(2, 3))
        data = SimpleNamespace(root_link_pos_w=torch.tensor([[0.,0.,.04],[0.,0.,.04]]),
            root_link_quat_w=torch.tensor([[.7071068,0.,.7071068,0.]]).repeat(2,1),
            root_link_ang_vel_b=torch.zeros(2,3),root_link_lin_vel_w=torch.zeros(2,3))
        env = SimpleNamespace(num_envs=2,device='cpu',step_dt=.02,episode_length_buf=torch.full((2,),100),
            scene=Scene(robot=SimpleNamespace(data=data)),_roulade_max=torch.zeros(2))
        cfg = SimpleNamespace(terminations={})
        install_stalled_reset(cfg)
        manager = TerminationManager(cfg.terminations, env)
        with patch('mjlab_microduck.tasks.mdp._update_roulade_accum'), patch('mjlab_microduck.tasks.mdp._sensor_any_contact',return_value=torch.ones(2,dtype=torch.bool)):
            for _ in range(51):
                result = manager.compute()
            self.assertTrue(result.all())
            self.assertTrue(manager.time_outs.all())
            self.assertFalse(manager.terminated.any())
            manager.reset(torch.tensor([0]))
            self.assertEqual(manager.compute().tolist(),[False,True])


if __name__ == '__main__':
    unittest.main()
