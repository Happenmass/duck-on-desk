"""Reward counterexamples: a higher score must not come from simply rolling."""
import pathlib
import unittest
import numpy as np
import torch


def pose(**changes):
    fields = dict(upright=-1., head_contact=1., feet_contact=0., body_contact=0.,
                  feet_height=.24, feet_above_base=.1, support_offset=0.,
                  angular_speed=0., horizontal_speed=0., joint_speed=0.,
                  joint_limit_margin=.2, best_inversion=1., hold_seconds=0., phase=.4)
    fields.update(changes)
    state = {key: torch.tensor([value], dtype=torch.float32) for key, value in fields.items()}
    state['previous_action'] = torch.zeros(1, 14)
    return state


class HeadstandRewardTest(unittest.TestCase):
    def setUp(self):
        self.namespace = {}
        exec(pathlib.Path(__file__).with_name('headstand-reward.py').read_text(), self.namespace)
        self.reward = self.namespace['reward_environment']
        self.action = torch.zeros(1, 14)

    def score(self, **changes):
        state = pose(**changes)
        return self.reward(state, self.action, state).item()

    def test_lying_and_unsupported_inversion_have_no_continuing_bonus(self):
        self.assertLessEqual(self.score(upright=0, head_contact=0), 0)
        self.assertLessEqual(self.score(head_contact=0), 0)
        self.assertLessEqual(self.score(body_contact=1), 0)
        self.assertLessEqual(self.score(feet_above_base=-.01), 0)
        self.assertLessEqual(self.score(angular_speed=3), 0)

    def test_repeated_complete_rolls_cannot_farm_progress(self):
        best = 0.; total = 0.
        before = pose(upright=1., head_contact=0., best_inversion=0.)
        for angle in np.linspace(0, 8*np.pi, 400):
            upright = float(np.cos(angle)); best = max(best, (1-upright)/2)
            after = pose(upright=upright, head_contact=0., best_inversion=best, angular_speed=np.pi)
            total += self.reward(before, self.action, after).item(); before = after
        self.assertLessEqual(total, 0., 'Repeated unsupported rolling must lose, not accumulate, reward')

    def test_posture_and_continuous_hold_matter(self):
        good = self.score()
        self.assertGreater(good, 0)
        self.assertGreater(self.score(hold_seconds=2.), self.score(hold_seconds=.02))
        for change in [dict(support_offset=.12), dict(joint_speed=5.), dict(joint_limit_margin=-.1)]:
            self.assertGreater(good, self.score(**change), change)

    def test_components_add_up_and_mps_matches_cpu(self):
        state = pose(hold_seconds=.6, support_offset=.01, joint_speed=.5)
        components = self.namespace['reward_components'](state, self.action, state)
        expected = self.reward(state, self.action, state)
        torch.testing.assert_close(sum(components.values()), expected)
        if torch.backends.mps.is_available():
            device_state = {k:v.to('mps') for k,v in state.items()}
            actual = self.reward(device_state, self.action.to('mps'), device_state).cpu()
            torch.testing.assert_close(actual, expected, atol=1e-5, rtol=1e-5)


if __name__ == '__main__': unittest.main()
