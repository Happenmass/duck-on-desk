import torch

def build_policy(observation_dim, action_dim):
    """Official actor architecture, with all Linear parameters trainable.

    The training setting chooses original walking weights or random weights.
    Resuming a run always restores its saved network and normalization.
    """
    return torch.nn.Sequential(
        torch.nn.Linear(observation_dim, 512), torch.nn.ELU(),
        torch.nn.Linear(512, 256), torch.nn.ELU(),
        torch.nn.Linear(256, 128), torch.nn.ELU(),
        torch.nn.Linear(128, action_dim),
    )
