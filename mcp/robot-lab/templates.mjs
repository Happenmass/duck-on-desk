export const templates = {
  'reward.py': `def reward(observation, action, next_observation):
    """Synthetic probe only; index 0 is NOT a robot speed contract."""
    feature_error = next_observation[:, 0] - 0.2
    return -(feature_error ** 2) - 0.01 * (action ** 2).sum(dim=-1)
`,
  'strategy.py': `import torch


def build_policy(observation_dim, action_dim):
    return torch.nn.Sequential(
        torch.nn.Linear(observation_dim, 64),
        torch.nn.Tanh(),
        torch.nn.Linear(64, action_dim),
        torch.nn.Tanh(),
    )
`,
  'training.json': JSON.stringify({ schema_version: 1, task: 'microduck-flat-walk', algorithm: 'ppo', training_device: 'mps', inference_device: 'mps', physics_backend: 'mujoco_cpu', seed: 0, max_iterations: 100 }, null, 2) + '\n',
};
