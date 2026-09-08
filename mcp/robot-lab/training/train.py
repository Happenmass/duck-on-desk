"""Bounded PPO training on real MuJoCo rollouts. Emits structured progress JSONL."""
import sys
import json
import pathlib
import time
import hashlib
import copy
import contextlib
import os
import numpy as np
import torch
from torch import nn
from torch.distributions import Normal
import onnxruntime as ort
from environment import Environments, CONTRACT, DT
from policy import BasePolicy, Actor


def emit(value):
    print(json.dumps(value, allow_nan=False), flush=True)


def evaluate(actor, asset_dir, device, target, seed, steps=250):
    env = Environments(asset_dir, 3, seed, target)
    errors = []; falls = 0; alive = np.ones(3, dtype=bool); frames = []
    actor.eval()
    for step in range(steps):
        with torch.inference_mode(): action = actor(torch.tensor(env.observe(), device=device)).cpu().numpy()
        state, done, fallen = env.step(action)
        errors.extend(np.abs(state['forward_velocity']-target).tolist())
        falls += int((fallen & alive).sum()); alive &= ~fallen
        if step % 5 == 0: frames.append(env.data[0].qpos.tolist())
        for i, flag in enumerate(done):
            if flag: env.reset(i)
    return {'fall_rate': falls/3, 'velocity_mae': float(np.mean(errors)), 'seconds': steps*DT,
            'environments': 3, 'frames': frames}


def main():
    config = json.loads(pathlib.Path(sys.argv[1]).read_text())
    torch.set_num_threads(1); torch.manual_seed(config['seed']); np.random.seed(config['seed'])
    for device in {config['training_device'], config['inference_device']}:
        if device == 'mps' and not torch.backends.mps.is_available(): raise ValueError('MPS unavailable; no CPU fallback')
        if device == 'cuda' and not torch.cuda.is_available(): raise ValueError('CUDA unavailable; no CPU fallback')
    device = torch.device(config['training_device'])
    inference = torch.device(config['inference_device'])
    namespace = {}; reward_namespace = {}
    # These are explicitly submitted trusted project scripts, not sandboxed code.
    with contextlib.redirect_stdout(sys.stderr):
        exec(compile(config['strategy'], 'strategy.py', 'exec'), namespace)
        exec(compile(config['reward'], 'reward.py', 'exec'), reward_namespace)
    base = BasePolicy(config['base_policy'])
    residual = namespace['build_policy'](61, 14)
    actor = Actor(base, residual).to(device)
    original = [p.detach().clone() for p in residual.parameters()]
    critic = nn.Sequential(nn.Linear(61,64), nn.Tanh(), nn.Linear(64,1)).to(device)
    optimizer = torch.optim.Adam(list(residual.parameters())+list(critic.parameters()), lr=config['learning_rate'])
    # Validate conversion against the original ONNX before any optimization.
    original_ort = ort.InferenceSession(config['base_policy'], providers=['CPUExecutionProvider'])
    x = np.random.default_rng(config['seed']).normal(0,0.1,(1,61)).astype(np.float32)
    with torch.inference_mode(): imported = base(torch.tensor(x, device=device)).cpu().numpy()
    expected = original_ort.run(['actions'], {'obs': x})[0]
    import_error = float(np.max(np.abs(imported-expected)))
    if import_error > 0.002: raise ValueError('Base ONNX import mismatch')
    env = Environments(config['asset_dir'], config['environments'], config['seed'], config['target_speed'])
    baseline_actor = copy.deepcopy(base)
    emit({'phase':'evaluating_baseline', 'model_hash':env.model_hash})
    baseline = evaluate(baseline_actor, config['asset_dir'], device, config['target_speed'], 1001)
    emit({'phase':'training', 'baseline':{k:v for k,v in baseline.items() if k!='frames'}})
    started = time.monotonic(); total_steps = 0
    for iteration in range(config['iterations']):
        if pathlib.Path(config['cancel_file']).exists():
            emit({'phase':'cancelled'}); return
        if time.monotonic()-started > config['max_seconds']: raise TimeoutError('Training time budget exceeded')
        actor.train(); critic.train()
        obs_list=[]; acts=[]; probs=[]; rewards=[]; values=[]; dones=[]
        for step in range(config['rollout_steps']):
            obs = torch.tensor(env.observe(),device=device)
            state = {k:torch.tensor(v,device=device) for k,v in env.state().items()}
            with torch.no_grad():
                mean = actor(obs); distribution = Normal(mean, 0.025, validate_args=False)
                action = distribution.sample(); logprob = distribution.log_prob(action).sum(-1)
                value = critic(obs).squeeze(-1)
            next_state, done, fallen = env.step(action.cpu().numpy())
            next_state = {k:torch.tensor(v,device=device) for k,v in next_state.items()}
            with contextlib.redirect_stdout(sys.stderr), torch.no_grad():
                reward = reward_namespace['reward_environment'](state, action, next_state)
            if not isinstance(reward, torch.Tensor) or reward.shape != (config['environments'],) or not torch.isfinite(reward).all():
                raise ValueError('reward_environment must return finite [environments] tensors')
            reward = reward.to(device) - 2*torch.tensor(fallen, device=device, dtype=torch.float32)
            obs_list.append(obs); acts.append(action); probs.append(logprob); rewards.append(reward); values.append(value)
            dones.append(torch.tensor(done,device=device,dtype=torch.float32))
            for i, flag in enumerate(done):
                if flag: env.reset(i)
            total_steps += config['environments']
        with torch.no_grad(): next_value = critic(torch.tensor(env.observe(),device=device)).squeeze(-1)
        advantages=[]; gae=torch.zeros(config['environments'],device=device)
        for i in reversed(range(config['rollout_steps'])):
            mask = 1-dones[i]
            delta = rewards[i]+0.99*next_value*mask-values[i]
            gae = delta+0.99*0.95*mask*gae
            advantages.insert(0,gae); next_value=values[i]
        advantage = torch.stack(advantages).flatten().detach()
        returns = (torch.stack(advantages)+torch.stack(values)).flatten().detach()
        advantage = (advantage-advantage.mean())/(advantage.std()+1e-6)
        observations=torch.cat(obs_list); actions=torch.cat(acts); old_logprob=torch.cat(probs)
        for epoch in range(4):
            distribution=Normal(actor(observations),0.025,validate_args=False)
            ratio=(distribution.log_prob(actions).sum(-1)-old_logprob).exp()
            policy_loss=-torch.minimum(ratio*advantage,ratio.clamp(0.8,1.2)*advantage).mean()
            value_loss=(critic(observations).squeeze(-1)-returns).square().mean()
            loss=policy_loss+0.5*value_loss
            if not torch.isfinite(loss): raise ValueError('Non-finite PPO loss')
            optimizer.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(list(residual.parameters())+list(critic.parameters()),0.5)
            optimizer.step()
        emit({'phase':'training','iteration':iteration+1,'iterations':config['iterations'],'environment_steps':total_steps,
              'mean_reward':float(torch.stack(rewards).mean().cpu()),'policy_loss':float(policy_loss.detach().cpu()),
              'value_loss':float(value_loss.detach().cpu()),'elapsed_seconds':round(time.monotonic()-started,2)})
    delta=sum(float((p-old).abs().sum().detach().cpu()) for p,old in zip(residual.parameters(),original))
    if not np.isfinite(delta) or delta<=0: raise ValueError('Training made no finite parameter update')
    actor.to(inference)
    emit({'phase':'evaluating_candidate'})
    candidate=evaluate(actor,config['asset_dir'],inference,config['target_speed'],1001)
    output=pathlib.Path(config['output_dir']); output.mkdir(parents=True,exist_ok=True)
    # Checkpoints and policies are written only to the user-level model cache.
    torch.save({'actor':actor.state_dict(),'critic':critic.state_dict(),'optimizer':optimizer.state_dict(),
                'config':config,'environment_steps':total_steps,'torch_rng_state':torch.get_rng_state()},output/'checkpoint.pt')
    actor.cpu().eval()
    with contextlib.redirect_stdout(sys.stderr):
        torch.onnx.export(actor,torch.zeros(1,61),str(output/'policy.onnx'),input_names=['obs'],output_names=['actions'],opset_version=17,dynamo=False)
    exported=ort.InferenceSession(str(output/'policy.onnx'),providers=['CPUExecutionProvider'])
    with torch.inference_mode(): native=actor(torch.tensor(x)).numpy()
    export_error=float(np.max(np.abs(native-exported.run(['actions'],{'obs':x})[0])))
    if export_error>0.002: raise ValueError('Exported ONNX differs from trained policy')
    # Non-regression admission, separate from a claim of improved walking.
    accepted = candidate['fall_rate'] <= baseline['fall_rate'] and candidate['velocity_mae'] <= baseline['velocity_mae']+0.03
    manifest={'contract':CONTRACT['version'],'model_hash':env.model_hash,'robot':'microduck','morphology':'legs:0cm','role':'walk',
              'training_device':str(device),'inference_device':str(inference),'physics_backend':'mujoco_cpu',
              'environment_steps':total_steps,'iterations':config['iterations'],'parameter_l1_change':delta,
              'base_import_max_error':import_error,'onnx_export_max_error':export_error,'native_evaluation_passed':accepted,
              'baseline':{k:v for k,v in baseline.items() if k!='frames'},'candidate':{k:v for k,v in candidate.items() if k!='frames'},
              'policy_sha256':hashlib.sha256((output/'policy.onnx').read_bytes()).hexdigest(),
              'reward_sha256':hashlib.sha256(config['reward'].encode()).hexdigest(),'strategy_sha256':hashlib.sha256(config['strategy'].encode()).hexdigest()}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2))
    (output/'preview.json').write_text(json.dumps({'dt':DT*5,'qpos':candidate['frames']}))
    emit({'phase':'completed','manifest':manifest})

if __name__=='__main__':
    try: main()
    except Exception as error:
        emit({'phase':'failed','error':str(error)[:1500]}); sys.exit(1)
