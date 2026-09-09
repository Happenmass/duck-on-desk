"""Bounded PPO training on real MuJoCo rollouts. Emits structured progress JSONL."""
import sys
import json
import pathlib
import time
import hashlib
import copy
import contextlib
import os
import signal
import random
import checkpoints
import ppo
from functools import partial
import numpy as np
import torch
from torch import nn
from torch.distributions import Normal
import onnxruntime as ort
from environment import Environments, CONTRACT, DT
from policy import official_finetune_policy, randomize_policy
from action_environment import ActionEnvironments, evaluate_action, HeadstandEnvironments, evaluate_headstand, HeadstandHoldEnvironments, evaluate_headstand_hold, HOLD_REFERENCE, DURATION
from preview import LivePreview
from reward_metrics import reward_breakdown


def emit(value):
    print(json.dumps(value, allow_nan=False), flush=True)


def evaluate(actor, asset_dir, device, target, seed, steps=250, preview=None, stage="evaluation", iteration=0):
    env = Environments(asset_dir, 3, seed, target)
    errors = []; falls = 0; alive = np.ones(3, dtype=bool); frames = []
    actor.eval()
    for step in range(steps):
        with torch.inference_mode(): action = actor(torch.tensor(env.observe(), device=device)).cpu().numpy()
        state, done, fallen = env.step(action)
        errors.extend(np.abs(state['forward_velocity']-target).tolist())
        falls += int((fallen & alive).sum()); alive &= ~fallen
        if preview: preview.publish(env, iteration, stage)
        if step % 5 == 0: frames.append(env.data[0].qpos.tolist())
        for i, flag in enumerate(done):
            if flag: env.reset(i)
    return {'fall_rate': falls/3, 'velocity_mae': float(np.mean(errors)), 'seconds': steps*DT,
            'environments': 3, 'frames': frames}


def main():
    config = json.loads(pathlib.Path(sys.argv[1]).read_text())
    preview = LivePreview(config)
    stopping = False
    def request_stop(*_):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    random.seed(config['seed'])
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
    actor = official_finetune_policy(config['base_policy'], namespace['build_policy']).to(device)
    is_hold = config.get('task') == 'microduck-headstand-hold'
    is_headstand = is_hold or config.get('task') == 'microduck-headstand'
    is_action = is_headstand or config.get('task') == 'microduck-headstand-dance'
    env_type = HeadstandHoldEnvironments if is_hold else HeadstandEnvironments if is_headstand else ActionEnvironments if is_action else Environments
    env = env_type(config['asset_dir'], config['environments'], config['seed'], config['target_speed'], **({'official_observations':True} if is_action else {}),
                   **({'reset_on_pose_loss':config.get('reset_on_pose_loss',True),'episode_steps':config.get('hold_episode_steps',400)} if is_hold else {}))
    evaluate_run = evaluate_headstand_hold if is_hold else evaluate_headstand if is_headstand else evaluate_action if is_action else evaluate
    if is_action:
        evaluate_run = partial(evaluate_run, official_observations=True)
    component_fn = reward_namespace.get('reward_components')
    if not callable(component_fn): component_fn = None
    modern = ppo.recipe(config)['profile'] == ppo.CURRENT
    critic = ppo.build_critic(config).to(device)
    exploration = ppo.Exploration(.15 if config.get('policy_initialization') == 'random' else .025).to(device) if modern else None
    optimizer = torch.optim.Adam(list(actor.parameters())+list(critic.parameters())+(list(exploration.parameters()) if modern else []), lr=config['learning_rate'])
    # Validate conversion against the original ONNX before any optimization.
    original_ort = ort.InferenceSession(config['base_policy'], providers=['CPUExecutionProvider'])
    x = np.random.default_rng(config['seed']).normal(0,0.1,(1,61)).astype(np.float32)
    with torch.inference_mode(): imported = actor(torch.tensor(x, device=device)).cpu().numpy()
    expected = original_ort.run(['actions'], {'obs': x})[0]
    import_error = float(np.max(np.abs(imported-expected)))
    if import_error > 0.002: raise ValueError('Base ONNX import mismatch')
    baseline_actor = copy.deepcopy(actor)
    emit({'phase':'evaluating_baseline', 'model_hash':env.model_hash})
    baseline = evaluate_run(baseline_actor, config['asset_dir'], device, config['target_speed'], 1001, preview=preview, stage='baseline')
    emit({'phase':'training', 'baseline':{k:v for k,v in baseline.items() if k!='frames'}})
    initialization = config.get('policy_initialization', 'official')
    if initialization not in ('official', 'random'): raise ValueError('Unknown policy initialization')
    if initialization == 'random': randomize_policy(actor)
    start_iteration = 0; total_steps = 0; schedule_iterations = config['iterations']
    restored_simulation = False
    if config.get('resume_checkpoint'):
        start_iteration, total_steps, schedule_iterations, restored_simulation = checkpoints.load(
            config['resume_checkpoint'], config['resume_checkpoint_sha256'], actor, critic, optimizer, env, config, exploration=exploration)
        if start_iteration != config['resume_iteration']:
            raise ValueError('Resume checkpoint progress changed')
        emit({'phase':'training', 'resumed_from': config['resume_run_id'],
              'start_iteration':start_iteration, 'restored_simulation':restored_simulation})
    starting_actor_sha256 = hashlib.sha256(b''.join(v.detach().cpu().numpy().tobytes() for v in actor.state_dict().values())).hexdigest()
    original = {name:p.detach().clone() for name,p in actor.named_parameters()}
    target_iteration = start_iteration + config['iterations']
    completed_iteration = start_iteration
    output = pathlib.Path(config['output_dir']); output.mkdir(parents=True, exist_ok=True)
    def save_checkpoint():
        info = checkpoints.save(output/'checkpoint.pt', actor, critic, optimizer, env, config,
                                completed_iteration, total_steps, schedule_iterations, exploration=exploration)
        emit({'checkpoint': info})
    started = time.monotonic()
    def stop_requested():
        return stopping or pathlib.Path(config['cancel_file']).exists() or time.monotonic()-started > config['max_seconds']
    for iteration in range(start_iteration, target_iteration):
        if stop_requested():
            if completed_iteration: save_checkpoint()
            emit({'phase':'cancelled'}); return
        actor.train(); critic.train()
        noise_std = (0.04 - 0.03 * min(1, iteration / max(1, schedule_iterations-1))) if is_hold else 0.3 if is_headstand else 0.12 if is_action else 0.025
        if modern: noise_std = exploration().detach().clone()
        obs_list=[]; means=[]; acts=[]; probs=[]; rewards=[]; learning_rewards=[]; values=[]; dones=[]
        reward_states=[]; reward_next_states=[]; script_rewards=[]; penalties=[]
        valid_postures=0; max_hold=0.; timeout_resets=0; failure_resets=0
        for step in range(config['rollout_steps']):
            obs = torch.tensor(env.observe(),device=device)
            state = {k:torch.tensor(v,device=device) for k,v in env.state().items()}
            with torch.no_grad():
                mean = actor(obs); distribution = Normal(mean, noise_std, validate_args=False)
                action = distribution.sample(); logprob = distribution.log_prob(action).sum(-1)
                value = critic(obs).squeeze(-1)
            next_state, done, fallen = env.step(action.cpu().numpy())
            timeout_resets += int((done & ~fallen).sum()); failure_resets += int(fallen.sum())
            if is_headstand:
                valid_postures += int((next_state['hold_seconds'] > 0).sum())
                max_hold = max(max_hold, float(next_state['hold_seconds'].max()))
            preview.publish(env, iteration + 1, 'sampling')
            next_state = {k:torch.tensor(v,device=device) for k,v in next_state.items()}
            with contextlib.redirect_stdout(sys.stderr), torch.no_grad():
                reward = reward_namespace['reward_environment'](state, action, next_state)
            if not isinstance(reward, torch.Tensor) or reward.shape != (config['environments'],) or not torch.isfinite(reward).all():
                raise ValueError('reward_environment must return finite [environments] tensors')
            penalty = -2*torch.tensor(fallen, device=device, dtype=torch.float32)
            if component_fn:
                reward_states.append(state); reward_next_states.append(next_state)
                script_rewards.append(reward); penalties.append(penalty)
            reward = reward.to(device) + penalty
            learning_reward = reward
            if modern:
                # Time limits truncate a continuing task; a fall is terminal.
                timeout = torch.tensor(done & ~fallen, device=device, dtype=torch.float32)
                with torch.no_grad():
                    learning_reward = reward + .99*critic(torch.tensor(env.observe(),device=device)).squeeze(-1)*timeout
            learning_rewards.append(learning_reward)
            obs_list.append(obs); means.append(mean); acts.append(action); probs.append(logprob); rewards.append(reward); values.append(value)
            dones.append(torch.tensor(done,device=device,dtype=torch.float32))
            for i, flag in enumerate(done):
                if flag: env.reset(i)
            total_steps += config['environments']
        with torch.no_grad(): next_value = critic(torch.tensor(env.observe(),device=device)).squeeze(-1)
        advantages=[]; gae=torch.zeros(config['environments'],device=device)
        for i in reversed(range(config['rollout_steps'])):
            mask = 1-dones[i]
            delta = learning_rewards[i]+0.99*next_value*mask-values[i]
            gae = delta+0.99*0.95*mask*gae
            advantages.insert(0,gae); next_value=values[i]
        advantage = torch.stack(advantages).flatten().detach()
        returns = (torch.stack(advantages)+torch.stack(values)).flatten().detach()
        advantage = (advantage-advantage.mean())/(advantage.std()+1e-6)
        observations=torch.cat(obs_list); actions=torch.cat(acts); old_logprob=torch.cat(probs)
        update_metrics = {}
        if modern:
            update_metrics = ppo.update(actor, critic, exploration, optimizer, observations, actions, old_logprob,
                                        torch.cat(values), returns, advantage, torch.cat(means), noise_std, config)
            policy_loss = torch.tensor(update_metrics['policy_loss']); value_loss = torch.tensor(update_metrics['value_loss'])
            preview.publish(env, iteration + 1, 'learning')
        else:
            for epoch in range(4):
                distribution=Normal(actor(observations),noise_std,validate_args=False)
                ratio=(distribution.log_prob(actions).sum(-1)-old_logprob).exp()
                policy_loss=-torch.minimum(ratio*advantage,ratio.clamp(0.8,1.2)*advantage).mean()
                value_loss=(critic(observations).squeeze(-1)-returns).square().mean()
                loss=policy_loss+0.5*value_loss
                if not torch.isfinite(loss): raise ValueError('Non-finite PPO loss')
                optimizer.zero_grad(); loss.backward()
                nn.utils.clip_grad_norm_(list(actor.parameters())+list(critic.parameters()),0.5)
                optimizer.step()
                preview.publish(env, iteration + 1, 'learning')
        with contextlib.redirect_stdout(sys.stderr), torch.no_grad():
            breakdown = reward_breakdown(component_fn, reward_states, acts, reward_next_states, script_rewards, penalties)
        posture_metrics = {'headstand_max_hold_seconds':max_hold,
                           'headstand_valid_percent':100*valid_postures/(config['environments']*config['rollout_steps'])} if is_headstand else {}
        completed_iteration = iteration + 1
        if completed_iteration % 10 == 0 or completed_iteration == target_iteration or stop_requested():
            save_checkpoint()
        emit({'phase':'training','iteration':iteration+1,'iterations':target_iteration,'environment_steps':total_steps,
              'session_iteration':iteration+1-start_iteration,'start_iteration':start_iteration,
              'timeout_resets':timeout_resets,'failure_resets':failure_resets,
              'mean_reward':float(torch.stack(rewards).mean().cpu()),'policy_loss':float(policy_loss.detach().cpu()),
              'value_loss':float(value_loss.detach().cpu()),'elapsed_seconds':round(time.monotonic()-started,2),
              **({'exploration_std':noise_std} if is_hold and not modern else {}), **update_metrics,
              **breakdown, **posture_metrics})
    if stop_requested():
        emit({'phase':'cancelled'}); return
    layer_changes={name:float((p-original[name]).abs().sum().detach().cpu()) for name,p in actor.named_parameters()}
    delta=sum(layer_changes.values())
    if not np.isfinite(delta) or delta<=0: raise ValueError('Training made no finite parameter update')
    actor.to(inference)
    emit({'phase':'evaluating_candidate'})
    candidate=evaluate_run(actor,config['asset_dir'],inference,config['target_speed'],1001,preview=preview,stage='candidate',iteration=target_iteration)
    actor.cpu().eval()
    with contextlib.redirect_stdout(sys.stderr):
        torch.onnx.export(actor,torch.zeros(1,61),str(output/'policy.onnx'),input_names=['obs'],output_names=['actions'],opset_version=17,dynamo=False)
    exported=ort.InferenceSession(str(output/'policy.onnx'),providers=['CPUExecutionProvider'])
    with torch.inference_mode(): native=actor(torch.tensor(x)).numpy()
    export_error=float(np.max(np.abs(native-exported.run(['actions'],{'obs':x})[0])))
    if export_error>0.002: raise ValueError('Exported ONNX differs from trained policy')
    # Non-regression admission, separate from a claim of improved walking.
    accepted = candidate['success'] if is_action else (candidate['fall_rate'] <= baseline['fall_rate'] and candidate['velocity_mae'] <= baseline['velocity_mae']+0.03)
    manifest={'contract':'duck-lab-action-v1' if is_action else CONTRACT['version'],'model_hash':env.model_hash,'robot':'microduck','morphology':'legs:0cm','role':'practice' if is_headstand else 'action' if is_action else 'walk', 'task':config.get('task','microduck-flat-walk'), 'duration':DURATION if is_action else None,
              'training_device':str(device),'inference_device':str(inference),'physics_backend':'mujoco_cpu',
              'environment_steps':total_steps,'iterations':target_iteration,'session_iterations':config['iterations'],
              'resume_run_id':config.get('resume_run_id'),'resume_iteration':start_iteration,
              'resume_checkpoint_sha256':config.get('resume_checkpoint_sha256'),'restored_simulation':restored_simulation,
              'parameter_l1_change':delta,'parameter_changes':layer_changes,
              'training_method':config.get('training_method','official-full-finetune-v1'),'policy_initialization':initialization,
              'starting_actor_sha256':starting_actor_sha256,'input_normalization':'identity' if initialization=='random' else 'official',
              'policy_architecture':[61,512,256,128,14], 'ppo':ppo.recipe(config),
              'critic_architecture':[61,512,256,128,1] if modern else [61,64,1],
              'batch_size':config['environments']*config['rollout_steps'],
              'reset_on_pose_loss':config.get('reset_on_pose_loss',True) if is_hold else None,
              'hold_episode_steps':config.get('hold_episode_steps',400) if is_hold else None,
              'final_learning_rate':optimizer.param_groups[0]['lr'],
              'trainable_policy_parameters':sum(p.numel() for p in actor.parameters()),
              'initial_policy_sha256':checkpoints.digest(config['base_policy']) if initialization=='official' else None,
              'reference_policy_sha256':checkpoints.digest(config['base_policy']),
              'policy_observations':'official-zero-commands-v1' if is_action else 'official-walk-v1',
              'preview_frames':preview.sequence,'preview_write_seconds':round(preview.write_seconds,6),
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
