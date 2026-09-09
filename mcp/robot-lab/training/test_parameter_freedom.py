"""Exercise formerly blocked settings through real PPO, checkpointing and export."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from test_official_finetune import ASSETS, BASE


class ParameterFreedomTest(unittest.TestCase):
    def test_large_batches_long_rollouts_and_single_sample_train_and_export(self):
        training = pathlib.Path(__file__).parent
        cache = pathlib.Path.home()/'.cache/huggingface/microduck-robot-lab'
        cache.mkdir(parents=True, exist_ok=True)
        for task, count, steps in [('microduck-flat-walk', 64, 1),
                                   ('microduck-headstand-hold', 1, 1),
                                   ('microduck-flat-walk', 1, 300)]:
            with self.subTest(task=task, count=count, steps=steps), tempfile.TemporaryDirectory(dir=cache) as tmp:
                root = pathlib.Path(tmp)
                hold = task == 'microduck-headstand-hold'
                config = dict(task=task, training_device='cpu', inference_device='cpu',
                              policy_initialization='random' if hold else 'official', ppo_profile='local-ppo-v2',
                              iterations=1, environments=count, rollout_steps=steps,
                              learning_rate=0 if hold else 1e-8, target_speed=0 if hold else -.3, seed=4294967296,
                              reset_on_pose_loss=False, hold_episode_steps=100000,
                              asset_dir=str(ASSETS), base_policy=str(BASE), output_dir=str(root/'output'),
                              cancel_file=str(root/'cancel'), max_seconds=-1,
                              reward=(training/('headstand-hold-reward.py' if hold else 'default-reward.py')).read_text(),
                              strategy=(training/'default-strategy.py').read_text())
                # An old saved deadline must not silently stop the new runner.
                file = root/'input.json'; file.write_text(json.dumps(config))
                result = subprocess.run([sys.executable, '-B', str(training/'train.py'), str(file)],
                                        capture_output=True, text=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stderr+result.stdout)
                events = [json.loads(line) for line in result.stdout.splitlines()]
                self.assertEqual(events[-1]['phase'], 'completed', result.stdout)
                manifest = json.loads((root/'output/manifest.json').read_text())
                self.assertEqual(manifest['environment_steps'], count*steps)
                self.assertLessEqual(manifest['final_learning_rate'], config['learning_rate'])
                if hold: self.assertEqual(manifest['parameter_l1_change'], 0)
                self.assertTrue((root/'output/checkpoint.pt').exists())
                self.assertTrue((root/'output/policy.onnx').exists())


if __name__ == '__main__': unittest.main()
