import torch

def build_policy(observation_dim, action_dim):
    """Residual network: zero initial correction preserves the base walking policy."""
    policy = torch.nn.Sequential(torch.nn.Linear(observation_dim, 64), torch.nn.Tanh(), torch.nn.Linear(64, action_dim))
    torch.nn.init.zeros_(policy[-1].weight)
    torch.nn.init.zeros_(policy[-1].bias)
    return policy
