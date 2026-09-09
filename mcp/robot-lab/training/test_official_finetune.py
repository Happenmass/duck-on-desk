import pathlib
import unittest
import numpy as np
import torch
import onnxruntime as ort
from policy import BasePolicy, official_finetune_policy, randomize_policy
from action_environment import HeadstandHoldEnvironments
from environment import Environments

ROOT = pathlib.Path(__file__).resolve().parents[3]
ASSETS = ROOT / 'renderer/public/robot/mjlab'
BASE = pathlib.Path.home()/'.cache/huggingface/microduck-simulator/183f99a40bd7308da3e848de961ed32bb02624a5/policies/BEST_alpha_walking.onnx'


class OfficialFinetuneTest(unittest.TestCase):
    def build(self):
        ns = {}; exec(pathlib.Path(__file__).with_name('default-strategy.py').read_text(), ns)
        return official_finetune_policy(BASE, ns['build_policy'])

    def test_original_weights_normalization_and_predictions_in_both_lesson_states(self):
        actor = self.build(); source = BasePolicy(BASE)
        self.assertEqual(sum(p.numel() for p in actor.parameters()),197774)
        self.assertTrue(all(p.requires_grad for p in actor.parameters()))
        for key,value in source.state_dict().items():
            torch.testing.assert_close(actor.state_dict()[key], value, rtol=0, atol=0)
        for env in [Environments(ASSETS, 3),HeadstandHoldEnvironments(ASSETS, 3, official_observations=True)]:
            for obs in env.observe():
                x=obs[None,:]
                reference=ort.InferenceSession(str(BASE),providers=['CPUExecutionProvider']).run(['actions'],{'obs':x})[0]
                for device in ['cpu']+(['mps'] if torch.backends.mps.is_available() else []):
                    actual=actor.to(device)(torch.tensor(x,device=device)).detach().cpu().numpy()
                    np.testing.assert_allclose(actual,reference,atol=2e-5,rtol=2e-5)

    def test_optimizer_updates_every_original_layer_but_not_normalization(self):
        torch.manual_seed(2); actor=self.build()
        before={k:v.detach().clone() for k,v in actor.state_dict().items()}
        optimizer=torch.optim.Adam(actor.parameters(),lr=.0001)
        obs=torch.randn(16,61)*.1
        actor(obs).square().mean().backward();optimizer.step()
        for name,p in actor.named_parameters():
            self.assertGreater(float((p-before[name]).abs().sum().detach()),0,name)
        for name in ['mean','scale']:
            torch.testing.assert_close(actor.state_dict()[name],before[name],rtol=0,atol=0)

    def test_random_initialization_is_seeded_nonzero_and_has_no_walking_statistics(self):
        reference = self.build()
        a = self.build(); torch.manual_seed(17); randomize_policy(a)
        b = self.build(); torch.manual_seed(17); randomize_policy(b)
        c = self.build(); torch.manual_seed(18); randomize_policy(c)
        self.assertEqual(sum(p.numel() for p in a.parameters()),197774)
        for name, param in a.named_parameters():
            self.assertTrue(param.requires_grad)
            self.assertGreater(torch.count_nonzero(param).item(),0)
            torch.testing.assert_close(param,b.state_dict()[name],rtol=0,atol=0)
            self.assertFalse(torch.equal(param,c.state_dict()[name]))
            self.assertFalse(torch.equal(param,reference.state_dict()[name]))
        self.assertTrue(torch.equal(a.mean,torch.zeros_like(a.mean)))
        self.assertTrue(torch.equal(a.scale,torch.ones_like(a.scale)))
        env=HeadstandHoldEnvironments(ASSETS,2,official_observations=True)
        self.assertTrue(torch.isfinite(a(torch.tensor(env.observe()))).all())

    def test_wrong_architecture_does_not_silently_train_a_residual(self):
        with self.assertRaisesRegex(ValueError,'官方'):
            official_finetune_policy(BASE,lambda obs,act:torch.nn.Sequential(torch.nn.Linear(obs,64),torch.nn.Tanh(),torch.nn.Linear(64,act)))
        def wrong(obs,act):
            model=self.build().net;model[1]=torch.nn.ReLU();return model
        with self.assertRaisesRegex(ValueError,'ELU'):
            official_finetune_policy(BASE,wrong)


if __name__ == '__main__': unittest.main()
