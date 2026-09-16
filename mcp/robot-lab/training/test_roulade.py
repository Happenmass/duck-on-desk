import pathlib
import tempfile
import unittest
from unittest.mock import patch
import torch
from roulade import initialize_from_walk


class Source(torch.nn.Module):
    def __init__(self, _):
        super().__init__()
        self.net = torch.nn.Sequential(torch.nn.Linear(61, 512), torch.nn.ELU(),
            torch.nn.Linear(512, 256), torch.nn.ELU(), torch.nn.Linear(256, 128), torch.nn.ELU(), torch.nn.Linear(128, 14))
        self.register_buffer('mean', torch.randn(61))
        self.register_buffer('scale', torch.rand(61) + .5)

    def forward(self, x):
        return self.net((x - self.mean) / self.scale)


class Target(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.obs_normalizer = torch.nn.Identity()
        self.mlp = Source(None).net

    def as_onnx(self, _):
        return self.mlp


class Tests(unittest.TestCase):
    def test_walking_normalization_is_preserved(self):
        with patch('policy.BasePolicy', Source):
            model = Target()
            self.assertLess(initialize_from_walk(model, 'unused'), .00001)
            self.assertTrue(all(p.requires_grad for p in model.parameters()))


if __name__ == '__main__':
    unittest.main()
