import copy
import pathlib
import tempfile
import unittest
import torch
from torch import nn
from torch.distributions import Normal
import ppo
import checkpoints
from test_official_finetune import ASSETS, BASE
from action_environment import HeadstandHoldEnvironments


class PpoTest(unittest.TestCase):
    def test_adaptive_learning_rate_does_not_raise_a_small_user_value_to_a_hidden_floor(self):
        torch.manual_seed(2)
        actor=nn.Linear(61,14);critic=nn.Linear(61,1);noise=ppo.Exploration(.15)
        config={'ppo_profile':ppo.CURRENT,'learning_rate':1e-8}
        optimizer=torch.optim.Adam(list(actor.parameters())+list(critic.parameters())+list(noise.parameters()),lr=config['learning_rate'])
        obs=torch.zeros(4,61)
        with torch.no_grad():
            old_means=actor(obs)+1;std=noise().detach().clone()
            old=Normal(old_means,std);actions=old.sample()
            old_logprob=old.log_prob(actions).sum(-1);values=critic(obs).squeeze(-1)
        metrics=ppo.update(actor,critic,noise,optimizer,obs,actions,old_logprob,values,
                           torch.ones(4),torch.ones(4),old_means,std,config)
        self.assertLess(metrics['learning_rate'],config['learning_rate'])

    def test_value_clipping_resists_large_change_and_noise_is_trainable(self):
        # An excessive perfect fit is still penalized relative to rollout values.
        self.assertAlmostEqual(ppo.clipped_value_loss(torch.tensor([2.]), torch.tensor([0.]), torch.tensor([2.])).item(), 3.24, places=5)
        exploration=ppo.Exploration(.15)
        (-Normal(torch.zeros(14),exploration()).entropy().mean()).backward()
        self.assertTrue(torch.all(exploration.log_std.grad < 0))

    def test_minibatch_update_resume_preserves_noise_lr_and_next_update(self):
        cache=pathlib.Path.home()/'.cache/huggingface/microduck-robot-lab'
        for device in ['cpu']+(['mps'] if torch.backends.mps.is_available() else []):
            with self.subTest(device=device), tempfile.TemporaryDirectory(dir=cache) as tmp:
                torch.set_num_threads(1); torch.manual_seed(42)
                config=dict(ppo_profile=ppo.CURRENT,task='microduck-headstand-hold',training_method=checkpoints.RANDOM_METHOD,
                            base_policy=str(BASE),training_device=device,inference_device=device,iterations=5,
                            environments=2,rollout_steps=8,learning_rate=.0003,seed=2,target_speed=0,
                            reward='same',strategy='same',policy_initialization='random')
                def setup():
                    actor=nn.Linear(61,14).to(device); critic=ppo.build_critic(config).to(device)
                    exploration=ppo.Exploration(.15).to(device)
                    optimizer=torch.optim.Adam(list(actor.parameters())+list(critic.parameters())+list(exploration.parameters()),lr=.0003)
                    env=HeadstandHoldEnvironments(ASSETS,2,seed=2,official_observations=True)
                    return actor,critic,exploration,optimizer,env
                actor,critic,noise,opt,env=setup()
                obs=torch.randn(16,61,device=device)*.1
                def batch(a,c,n):
                    with torch.no_grad():
                        means=a(obs);std=n().detach().clone();dist=Normal(means,std);action=dist.sample()
                        return [obs,action,dist.log_prob(action).sum(-1),c(obs).squeeze(-1),torch.randn(16,device=device),torch.randn(16,device=device),means,std]
                data=batch(actor,critic,noise)
                metrics=ppo.update(actor,critic,noise,opt,*data,config)
                self.assertEqual(metrics['optimizer_updates'],20)
                self.assertEqual(metrics['minibatch_size'],4)
                self.assertLessEqual(metrics['learning_rate'],.0003)
                self.assertGreaterEqual(metrics['approx_kl'],0)
                file=pathlib.Path(tmp)/'checkpoint.pt'
                info=checkpoints.save(file,actor,critic,opt,env,config,1,16,5,exploration=noise)
                # Fixed rollout: resume must reproduce the next shuffle and update.
                data=batch(actor,critic,noise)
                info=checkpoints.save(file,actor,critic,opt,env,config,1,16,5,exploration=noise)
                ppo.update(actor,critic,noise,opt,*data,config)
                a,c,n,o,e=setup()
                checkpoints.load(file,info['sha256'],a,c,o,e,config,exploration=n)
                ppo.update(a,c,n,o,*data,config)
                for x,y in zip(list(actor.parameters())+list(critic.parameters())+list(noise.parameters()),list(a.parameters())+list(c.parameters())+list(n.parameters())):
                    torch.testing.assert_close(x,y,rtol=1e-4,atol=1e-6)
                self.assertEqual(o.param_groups[0]['lr'],opt.param_groups[0]['lr'])
                with self.assertRaisesRegex(ValueError,'preserve ppo_profile'):
                    checkpoints.load(file,info['sha256'],a,c,o,e,{**config,'ppo_profile':ppo.LEGACY},exploration=n)

if __name__=='__main__': unittest.main()
