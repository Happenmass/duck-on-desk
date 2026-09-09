import pathlib
import tempfile
import unittest
import numpy as np
import torch
from torch import nn
import checkpoints
from test_official_finetune import ASSETS, BASE
from policy import BasePolicy
from action_environment import HeadstandHoldEnvironments


class CheckpointTest(unittest.TestCase):
    def test_resume_preserves_next_update_simulation_rng_and_optimizer(self):
        # Real weights stay in the global user model cache, including test outputs.
        cache = pathlib.Path.home()/'.cache/huggingface/microduck-robot-lab'
        cache.mkdir(parents=True, exist_ok=True)
        for device in ['cpu'] + (['mps'] if torch.backends.mps.is_available() else []):
            with self.subTest(device=device), tempfile.TemporaryDirectory(prefix='resume-test-', dir=cache) as tmp:
                config = dict(task='microduck-headstand-hold', training_method=checkpoints.METHOD,
                              base_policy=str(BASE), training_device=device, inference_device=device,
                              iterations=20, environments=2, rollout_steps=8, learning_rate=.0001, seed=2,
                              target_speed=0, reward='same reward', strategy='same architecture')
                def setup():
                    actor=BasePolicy(BASE).to(device)
                    critic=nn.Sequential(nn.Linear(61,64),nn.Tanh(),nn.Linear(64,1)).to(device)
                    optimizer=torch.optim.Adam(list(actor.parameters())+list(critic.parameters()),lr=.0001)
                    env=HeadstandHoldEnvironments(ASSETS,2,seed=2,official_observations=True)
                    return actor,critic,optimizer,env
                def update(actor,critic,optimizer,env,observations=None):
                    obs=torch.tensor(env.observe() if observations is None else observations,device=device)
                    action=actor(obs)+torch.randn(2,14,device=device)*.01
                    loss=action.square().mean()+critic(obs).square().mean()
                    optimizer.zero_grad();loss.backward();optimizer.step()
                    env.step(action.detach().cpu().numpy())
                    return action.detach().cpu()
                actor,critic,optimizer,env=setup()
                update(actor,critic,optimizer,env)
                file=pathlib.Path(tmp)/'checkpoint.pt'
                info=checkpoints.save(file,actor,critic,optimizer,env,config,1,16,20)
                before=env.observe().copy()
                positions=[d.qpos.copy() for d in env.data]
                expected=update(actor,critic,optimizer,env)
                expected_obs=env.observe().copy()
                next_actor,next_critic,next_optimizer,next_env=setup()
                restored=checkpoints.load(file,info['sha256'],next_actor,next_critic,next_optimizer,next_env,config)
                self.assertEqual(restored,(1,16,20,True))
                for data,position in zip(next_env.data,positions):
                    np.testing.assert_array_equal(data.qpos,position)
                # Forward reconstruction refreshes MuJoCo's lagging sensors. Compare
                # learning on the same observations, and the next integrated state.
                actual=update(next_actor,next_critic,next_optimizer,next_env,before)
                torch.testing.assert_close(actual,expected,rtol=1e-5,atol=1e-6)
                np.testing.assert_allclose(next_env.observe(),expected_obs,rtol=1e-4,atol=2e-5)
                for a,b in zip(actor.parameters(),next_actor.parameters()):
                    torch.testing.assert_close(a,b,rtol=1e-5,atol=1e-6)
                self.assertEqual(int(next(iter(next_optimizer.state.values()))['step']),2)
                with self.assertRaisesRegex(ValueError,'preserve reward'):
                    checkpoints.load(file,info['sha256'],next_actor,next_critic,next_optimizer,next_env,{**config,'reward':'different'})
                with self.assertRaisesRegex(ValueError,'preserve reset_on_pose_loss'):
                    checkpoints.load(file,info['sha256'],next_actor,next_critic,next_optimizer,next_env,{**config,'reset_on_pose_loss':False})
                with self.assertRaisesRegex(ValueError,'preserve hold_episode_steps'):
                    checkpoints.load(file,info['sha256'],next_actor,next_critic,next_optimizer,next_env,{**config,'hold_episode_steps':0})
                with self.assertRaisesRegex(ValueError,'hash mismatch'):
                    checkpoints.load(file,'wrong',next_actor,next_critic,next_optimizer,next_env,config)
                old=torch.load(file,weights_only=True,map_location='cpu')
                for key in ['version','iteration','schedule_iterations','environment','device_rng_state']:
                    old.pop(key,None)
                old['config'].pop('training_method')
                torch.save(old,file)
                self.assertEqual(checkpoints.load(file,checkpoints.digest(file),next_actor,next_critic,next_optimizer,next_env,config),(1,16,20,False))


if __name__ == '__main__': unittest.main()
