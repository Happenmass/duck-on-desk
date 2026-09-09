"""Read-only checkpoint diagnostics; CPU evaluation never touches the live run."""
import hashlib
import io
import json
import pathlib
import sys
import numpy as np
import torch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'mcp/robot-lab/training'))
from policy import official_finetune_policy
from action_environment import HeadstandHoldEnvironments, evaluate_headstand_hold, supported_headstand
from checkpoints import restore_environment
from environment import DT

torch.set_num_threads(1)
run_id = sys.argv[1]
checkpoint_file = pathlib.Path.home() / '.cache/huggingface/microduck-robot-lab' / run_id / 'checkpoint.pt'
raw = checkpoint_file.read_bytes()
checkpoint = torch.load(io.BytesIO(raw), map_location='cpu', weights_only=True)
config = checkpoint['config']
namespace = {}
exec(compile(config['strategy'], 'saved-strategy.py', 'exec'), namespace)
actor = official_finetune_policy(config['base_policy'], namespace['build_policy'])
actor.load_state_dict(checkpoint['actor'], strict=True)
actor.eval()
env = HeadstandHoldEnvironments(config['asset_dir'], config['environments'], config['seed'], official_observations=True)
restore_environment(env, checkpoint['environment'])
snapshot = env.state()
report = {
    'run_id': run_id, 'iteration': checkpoint['iteration'],
    'checkpoint_sha256': hashlib.sha256(raw).hexdigest(), 'evaluation_device': 'cpu',
    'environment_steps': checkpoint['environment_steps'],
    'training_snapshot': {key: snapshot[key].tolist() for key in
        ('upright', 'head_contact', 'feet_contact', 'body_contact', 'angular_speed', 'support_offset', 'hold_seconds')},
    'simulation_age_steps': env.age.tolist(),
}
fresh = evaluate_headstand_hold(actor, config['asset_dir'], torch.device('cpu'), 0, 1001, official_observations=True)
report['fresh_evaluation'] = {key: value for key, value in fresh.items() if key != 'frames'}
# An additional evaluation starts from the first three actual training states,
# rather than returning the robot to the supplied near-headstand initialization.
env = HeadstandHoldEnvironments(config['asset_dir'], 3, config['seed'], official_observations=True)
saved = dict(checkpoint['environment'])
saved['physics'] = saved['physics'][:3]
saved['arrays'] = {key: value[:3] for key, value in saved['arrays'].items()}
restore_environment(env, saved)
holding = np.zeros(3, dtype=int)
longest = np.zeros(3, dtype=int)
valid_count = np.zeros(3, dtype=int)
inverted_count = np.zeros(3, dtype=int)
feet_count = np.zeros(3, dtype=int)
for _ in range(1000):
    with torch.inference_mode():
        actions = actor(torch.tensor(env.observe())).numpy()
    state, _, invalid = env.step(actions)
    if invalid.any():
        raise ValueError('Non-finite checkpoint evaluation')
    valid = supported_headstand(state)
    holding = np.where(valid, holding + 1, 0)
    longest = np.maximum(longest, holding)
    valid_count += valid
    inverted_count += state['upright'] < -0.8
    feet_count += state['feet_contact'] > 0
report['continue_from_training_state'] = {
    'environments': 3, 'seconds': 1000 * DT, 'exploration': False, 'resets': 0,
    'longest_hold_seconds': (longest * DT).tolist(),
    'terminal_hold_seconds': (holding * DT).tolist(),
    'strict_valid_percent': (valid_count / 10).tolist(),
    'inverted_percent': (inverted_count / 10).tolist(),
    'feet_contact_percent': (feet_count / 10).tolist(),
    'terminal_upright': state['upright'].tolist(),
}
output = ROOT / '.release-reviews/continuous-hold-1000' / f'checkpoint-{checkpoint["iteration"]}.json'
output.write_text(json.dumps(report, indent=2))
print(json.dumps({'path': str(output), **report}, ensure_ascii=False))
