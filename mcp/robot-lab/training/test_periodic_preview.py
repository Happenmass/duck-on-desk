import json
import pathlib
import tempfile
import unittest
import numpy as np
import torch
from preview import save_periodic_preview


class Environment:
    def __init__(self):
        self.data = [type('Data', (), {'qpos': np.array([0., 0, .12, 1, 0, 0, 0, 0])})()]
        self.qadr = [7]

    def observe(self):
        return np.zeros((1, 1), dtype=np.float32)

    def step(self, action):
        self.data[0].qpos[0] += .02


class PreviewTests(unittest.TestCase):
    def test_milestones_duration_and_rng(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {'output_dir': directory}
            actor = torch.nn.Linear(1, 1)
            actor.train()
            state = torch.get_rng_state().clone()
            for iteration in [0, 199, 201, 399]:
                save_periodic_preview(config, iteration, lambda: actor, Environment)
            self.assertFalse((pathlib.Path(directory) / 'previews').exists())
            for iteration in [200, 400]:
                save_periodic_preview(config, iteration, lambda: actor, Environment)
                clip = json.loads((pathlib.Path(directory) / 'previews' / f'iteration-{iteration}.json').read_text())
                self.assertEqual(len(clip['frames']), 501)
                self.assertEqual((len(clip['frames']) - 1) * clip['dt'], 10)
                self.assertAlmostEqual(clip['frames'][-1]['root'][0], 10)
            self.assertTrue(actor.training)
            self.assertTrue(torch.equal(state, torch.get_rng_state()))
            save_periodic_preview(config, 600, lambda: actor, Environment, lambda: True)
            self.assertFalse((pathlib.Path(directory) / 'previews' / 'iteration-600.json').exists())


if __name__ == '__main__':
    unittest.main()
