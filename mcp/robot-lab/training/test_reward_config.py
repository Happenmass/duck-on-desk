import copy
import pathlib
import unittest
from types import SimpleNamespace as NS
from reward_config import apply_reward_config

NAMES = {'action_rate_l2': 'action_rate_weight', 'arrival_damping': 'arrival_damping_weight',
         'joint_torque_rate_l2': 'torque_rate_weight', 'gentle_landing': 'gentle_landing_weight'}


class RewardConfigTests(unittest.TestCase):
    def test_official_recipe_unchanged(self):
        import mjlab_microduck.tasks
        from mjlab.tasks.registry import load_env_cfg
        cfg = copy.deepcopy(load_env_cfg('Mjlab-Roulade-Flat-MicroDuck'))
        before = copy.deepcopy(cfg)
        namespace = {}
        exec(pathlib.Path(__file__).with_name('roulade-official-reward.py').read_text(encoding='utf-8'), namespace)
        self.assertEqual(set(namespace['reward_weights']), set(cfg.rewards))
        self.assertEqual(apply_reward_config(cfg, namespace, NAMES), [])
        self.assertEqual({k: v.weight for k, v in before.rewards.items()}, {k: v.weight for k, v in cfg.rewards.items()})
        self.assertEqual(set(before.curriculum), set(cfg.curriculum))
        for key in NAMES.values():
            self.assertEqual(before.curriculum[key].params, cfg.curriculum[key].params)

    def test_fixed_and_scheduled(self):
        cfg = NS(rewards={'action_rate_l2': NS(weight=-.1)}, curriculum={'action_rate_weight': NS(params={})})
        data = {'reward_weights': {'action_rate_l2': -.2}, 'reward_schedules': {'action_rate_l2': [{'step': 0, 'weight': -.2}, {'step': 12, 'weight': -.4}]}}
        self.assertEqual(apply_reward_config(cfg, data, NAMES), [])
        self.assertEqual(cfg.curriculum['action_rate_weight'].params['weight_stages'], data['reward_schedules']['action_rate_l2'])
        data.pop('reward_schedules')
        self.assertEqual(apply_reward_config(cfg, data, NAMES), ['action_rate_weight'])

    def test_invalid_schedule_does_not_mutate(self):
        for stages in [[], [{'step': 0, 'weight': -.2}], [{'step': True, 'weight': -.1}], [{'step': 0, 'weight': float('nan')}], [{'step': 0, 'weight': -.1}, {'step': 0, 'weight': -.3}]]:
            cfg = NS(rewards={'action_rate_l2': NS(weight=-.1)}, curriculum={'action_rate_weight': NS(params={})})
            with self.assertRaises(ValueError):
                apply_reward_config(cfg, {'reward_weights': {'action_rate_l2': -.1}, 'reward_schedules': {'action_rate_l2': stages}}, NAMES)
            self.assertEqual(cfg.rewards['action_rate_l2'].weight, -.1)
            self.assertEqual(cfg.curriculum['action_rate_weight'].params, {})


if __name__ == '__main__':
    unittest.main()
