"""Official mjlab / microduck_rl training, driven by the Robot Lab UI. Emits progress JSONL on stdout."""
import sys
import json
import pathlib
import time
import hashlib
import os
import signal
import contextlib
import copy
import statistics
import types
from dataclasses import asdict

real_stdout = sys.stdout
sys.stdout = sys.stderr  # rsl_rl and mjlab print progress tables; stdout carries only JSONL for jobs.cjs

TASK = 'Mjlab-Velocity-Flat-MicroDuck'
# Official curricula that overwrite these reward weights by step; an explicit weight fixes the term instead.
CURRICULUM = {'action_rate_l2': 'action_rate_weight', 'head_pose_bias': 'head_pose_bias_weight'}


def emit(value):
    real_stdout.write(json.dumps(value, allow_nan=False) + '\n'); real_stdout.flush()


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


class Stop(Exception):
    pass


class PreviewView:
    """Presents the mjlab scene the way LivePreview reads the CPU environment: env.data[0].qpos and env.qadr."""
    def __init__(self, env, joints):
        self.env = env.unwrapped
        self.robot = self.env.scene['robot']
        names = list(self.robot.joint_names)
        missing = [name for name in joints if name not in names]
        if missing: raise ValueError(f'Official model lacks contract joints: {missing}')
        self.index = [names.index(name) for name in joints]
        self.qadr = slice(7, None)

    @property
    def data(self):
        import numpy as np
        data = self.robot.data
        qpos = np.concatenate([data.root_link_pose_w[0].cpu().numpy(), data.joint_pos[0, self.index].cpu().numpy()])
        return [types.SimpleNamespace(time=float(self.env.episode_length_buf[0]) * self.env.step_dt, qpos=qpos)]


def main():
    config = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    import numpy as np
    import torch
    import onnx
    import onnxruntime as ort
    from importlib.metadata import version
    import mjlab_microduck.tasks  # noqa: F401  registers Mjlab-*-MicroDuck and the official mdp patches
    from mjlab.envs import ManagerBasedRlEnv
    from mjlab.rl import RslRlVecEnvWrapper
    from mjlab.tasks.registry import load_env_cfg, load_rl_cfg, load_runner_cls
    from mjlab.utils.torch import configure_torch_backends
    from environment import CONTRACT, DT
    from policy import BasePolicy
    from preview import LivePreview
    from train import evaluate

    stopping = False
    def request_stop(*_):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, request_stop); signal.signal(signal.SIGINT, request_stop)
    def stop_requested():
        return stopping or pathlib.Path(config['cancel_file']).exists()

    for device in {config['training_device'], config['inference_device']}:
        if device == 'mps' and not torch.backends.mps.is_available(): raise ValueError('MPS unavailable; no CPU fallback')
        if device == 'cuda' and not torch.cuda.is_available(): raise ValueError('CUDA unavailable; no CPU fallback')
    device = 'cuda:0' if config['training_device'] == 'cuda' else config['training_device']
    sim_device = 'cuda:0' if device == 'cuda:0' else 'cpu'  # MuJoCo Warp has no Metal backend: physics on CPU, network on MPS
    inference = torch.device(config['inference_device'])
    configure_torch_backends()

    env_cfg = copy.deepcopy(load_env_cfg(TASK)); agent_cfg = copy.deepcopy(load_rl_cfg(TASK))
    env_cfg.scene.num_envs = int(config['environments']); env_cfg.seed = int(config['seed'])
    agent_cfg.seed = int(config['seed']); agent_cfg.num_steps_per_env = int(config['rollout_steps'])
    agent_cfg.algorithm.learning_rate = float(config['learning_rate'])
    agent_cfg.max_iterations = int(config['iterations'])
    agent_cfg.logger = 'tensorboard'; agent_cfg.upload_model = False  # no W&B account inside the app

    namespace = {}
    with contextlib.redirect_stdout(sys.stderr):  # explicitly submitted trusted project script, not sandboxed code
        exec(compile(config['reward'], 'reward.py', 'exec'), namespace)
    weights = namespace.get('reward_weights')
    if not isinstance(weights, dict): raise ValueError('第一课的奖励脚本需要定义 reward_weights 字典：官方奖励项名称 → 权重')
    curricula_disabled = []
    for name, weight in weights.items():
        if name not in env_cfg.rewards: raise ValueError(f'未知的官方奖励项：{name}。可用：{", ".join(env_cfg.rewards)}')
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or not np.isfinite(weight): raise ValueError(f'奖励权重必须是有限数字：{name}')
        env_cfg.rewards[name].weight = float(weight)
        if CURRICULUM.get(name) in env_cfg.curriculum:
            del env_cfg.curriculum[CURRICULUM[name]]; curricula_disabled.append(CURRICULUM[name])
    reward_weights = {name: term.weight for name, term in env_cfg.rewards.items()}

    output = pathlib.Path(config['output_dir']); output.mkdir(parents=True, exist_ok=True)
    preview = LivePreview(config)
    emit({'phase': 'evaluating_baseline'})
    baseline = evaluate(BasePolicy(config['base_policy']).to(inference), config['asset_dir'], inference, config['target_speed'], 1001, preview=preview, stage='baseline')
    emit({'phase': 'training', 'baseline': {k: v for k, v in baseline.items() if k != 'frames'}})

    env = RslRlVecEnvWrapper(ManagerBasedRlEnv(cfg=env_cfg, device=sim_device), clip_actions=agent_cfg.clip_actions)
    runner = load_runner_cls(TASK)(env, asdict(agent_cfg), str(output / 'logs'), device)
    view = PreviewView(env, CONTRACT['joints'])
    original_step = env.step
    def step(actions):
        result = original_step(actions)
        preview.publish(view, runner.current_learning_iteration + 1, 'sampling')
        return result
    env.step = step

    start_iteration = 0; start_steps = 0
    if config.get('resume_checkpoint'):
        if digest(config['resume_checkpoint']) != config['resume_checkpoint_sha256']: raise ValueError('Resume checkpoint hash mismatch')
        infos = runner.load(config['resume_checkpoint'])
        runner.current_learning_iteration += 1  # the saved iteration is complete; continue after it
        start_iteration = runner.current_learning_iteration; start_steps = int(infos.get('environment_steps', 0))
        if start_iteration != config['resume_iteration']: raise ValueError('Resume checkpoint progress changed')
        emit({'phase': 'training', 'resumed_from': config['resume_run_id'], 'start_iteration': start_iteration, 'restored_simulation': False})
    target_iteration = start_iteration + int(config['iterations'])
    per_iteration = int(config['environments']) * int(config['rollout_steps'])
    completed = start_iteration; total_steps = start_steps
    started = time.monotonic()

    def save_checkpoint():
        temporary = output / 'checkpoint.pt.tmp'
        runner.save(str(temporary), infos={'environment_steps': total_steps}); os.replace(temporary, output / 'checkpoint.pt')
        (output / f'{output.name}.onnx').unlink(missing_ok=True)  # the official runner also exports beside every checkpoint
        emit({'checkpoint': {'version': 'mjlab-rsl-rl-v1', 'iteration': completed, 'environment_steps': total_steps, 'sha256': digest(output / 'checkpoint.pt')}})

    logger = runner.logger; original_log = logger.log
    def log(it, **kw):
        nonlocal completed, total_steps
        completed = it + 1; total_steps = start_steps + (completed - start_iteration) * per_iteration
        components = {}
        for key in (logger.ep_extras[0] if logger.ep_extras else {}):
            if key.startswith('Episode_Reward/'):
                values = [torch.as_tensor(ep[key]).flatten().float().cpu() for ep in logger.ep_extras if key in ep]
                components[key[len('Episode_Reward/'):]] = float(torch.cat(values).mean())
        losses = {k: float(v) for k, v in kw['loss_dict'].items()}
        emit({'phase': 'training', 'iteration': completed, 'iterations': target_iteration, 'environment_steps': total_steps,
              'session_iteration': completed - start_iteration, 'start_iteration': start_iteration,
              'mean_reward': statistics.mean(logger.rewbuffer) if logger.rewbuffer else 0.0, 'completed_episodes': len(logger.rewbuffer),
              'mean_episode_seconds': statistics.mean(logger.lenbuffer) * DT if logger.lenbuffer else 0.0,
              'policy_loss': losses.get('surrogate', 0.0), 'value_loss': losses.get('value', 0.0), 'losses': losses,
              'learning_rate': float(kw['learning_rate']), 'action_std': float(kw['action_std'].detach().mean()),
              'collect_seconds': round(kw['collect_time'], 3), 'learn_seconds': round(kw['learn_time'], 3),
              'elapsed_seconds': round(time.monotonic() - started, 2),
              'reward_breakdown_status': 'verified' if components else 'unavailable', 'reward_components': components, 'automatic_penalty': 0.0})
        original_log(it=it, **kw)  # official console table on stderr, TensorBoard scalars under output/logs
        if completed % 10 == 0 or completed == target_iteration or stop_requested(): save_checkpoint()
        if stop_requested(): raise Stop
    logger.log = log

    try:
        runner.learn(num_learning_iterations=int(config['iterations']), init_at_random_ep_len=True)
    except Stop:
        emit({'phase': 'cancelled'}); return
    if stop_requested():
        emit({'phase': 'cancelled'}); return

    runner.export_policy_to_onnx(str(output), 'policy.onnx')
    model = onnx.load(str(output / 'policy.onnx'))
    if [i.name for i in model.graph.input] != ['obs'] or [o.name for o in model.graph.output] != ['actions']:
        raise ValueError('Exported ONNX must expose obs -> actions for the desktop runtime')
    onnx_policy = runner.alg.get_policy().as_onnx(verbose=False).cpu().eval()
    x = np.random.default_rng(int(config['seed'])).normal(0, 0.1, (1, 61)).astype(np.float32)
    with torch.inference_mode(): native = onnx_policy(torch.tensor(x)).numpy()
    exported = ort.InferenceSession(str(output / 'policy.onnx'), providers=['CPUExecutionProvider']).run(['actions'], {'obs': x})[0]
    export_error = float(np.max(np.abs(native - exported)))
    if export_error > 0.002: raise ValueError('Exported ONNX differs from trained policy')

    emit({'phase': 'evaluating_candidate'})
    candidate = evaluate(BasePolicy(str(output / 'policy.onnx')).to(inference), config['asset_dir'], inference, config['target_speed'], 1001, preview=preview, stage='candidate', iteration=target_iteration)
    accepted = candidate['fall_rate'] <= baseline['fall_rate'] and candidate['velocity_mae'] <= baseline['velocity_mae'] + 0.03
    ppo = json.loads(json.dumps(asdict(agent_cfg), default=str))
    manifest = {'contract': CONTRACT['version'], 'robot': 'microduck', 'morphology': 'legs:0cm', 'role': 'walk', 'task': config.get('task', 'microduck-flat-walk'), 'duration': None,
                'training_method': 'mjlab-official-v1', 'policy_initialization': 'random', 'mjlab_task': TASK,
                'mjlab_version': version('mjlab'), 'microduck_rl_commit': config.get('mjlab_commit'), 'rsl_rl_version': version('rsl-rl-lib'),
                'training_device': device, 'simulation_device': sim_device, 'inference_device': str(inference),
                'physics_backend': 'mjlab_warp_cuda' if sim_device.startswith('cuda') else 'mjlab_warp_cpu',
                'environment_steps': total_steps, 'iterations': target_iteration, 'session_iterations': int(config['iterations']),
                'resume_run_id': config.get('resume_run_id'), 'resume_iteration': start_iteration,
                'resume_checkpoint_sha256': config.get('resume_checkpoint_sha256'), 'restored_simulation': False,
                'environments': int(config['environments']), 'rollout_steps': int(config['rollout_steps']), 'batch_size': per_iteration,
                'episode_length_s': env_cfg.episode_length_s, 'control_dt': env.unwrapped.step_dt,
                'reward_weights': reward_weights, 'curricula': list(env_cfg.curriculum), 'curricula_disabled': curricula_disabled,
                'ppo': ppo, 'policy_architecture': [61, *agent_cfg.actor.hidden_dims, 14], 'input_normalization': 'official-online',
                'policy_observations': 'official-walk-v1', 'onnx_export_max_error': export_error, 'native_evaluation_passed': accepted,
                'baseline': {k: v for k, v in baseline.items() if k != 'frames'}, 'candidate': {k: v for k, v in candidate.items() if k != 'frames'},
                'preview_frames': preview.sequence, 'preview_write_seconds': round(preview.write_seconds, 6),
                'policy_sha256': digest(output / 'policy.onnx'), 'reference_policy_sha256': digest(config['base_policy']),
                'reward_sha256': hashlib.sha256(config['reward'].encode()).hexdigest()}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    (output / 'preview.json').write_text(json.dumps({'dt': DT * 5, 'qpos': candidate['frames']}))
    env.close()
    emit({'phase': 'completed', 'manifest': manifest})


if __name__ == '__main__':
    try: main()
    except Exception as error:
        emit({'phase': 'failed', 'error': str(error)[:1500]}); sys.exit(1)
