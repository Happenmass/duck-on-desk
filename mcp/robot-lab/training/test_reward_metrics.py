import unittest
import torch
from reward_metrics import reward_breakdown


class RewardMetricsTest(unittest.TestCase):
    def summarize(self, helper):
        states = [{'x':torch.tensor([1., 2.])}, {'x':torch.tensor([3., 4.])}]
        rewards = [s['x']*2 for s in states]
        return reward_breakdown(helper, states, [torch.zeros(2,14)]*2, states, rewards,
                                [torch.tensor([0.,-2.]), torch.zeros(2)])

    def test_actual_components_and_runner_penalty_reconcile(self):
        report = self.summarize(lambda s,a,n: {'one':n['x'], 'two':n['x']})
        self.assertEqual(report['reward_breakdown_status'], 'verified')
        self.assertEqual(sum(report['reward_components'].values())+report['automatic_penalty'], 4.5)

    def test_changed_custom_reward_is_never_misrepresented_or_overridden(self):
        report = self.summarize(lambda s,a,n: {'wrong':n['x']})
        self.assertEqual(report, {'reward_breakdown_status':'inconsistent'})
        self.assertEqual(self.summarize(None), {'reward_breakdown_status':'not_provided'})
        self.assertEqual(self.summarize(lambda *args: {'bad':torch.tensor([float('nan')])}),
                         {'reward_breakdown_status':'invalid'})


if __name__ == '__main__': unittest.main()
