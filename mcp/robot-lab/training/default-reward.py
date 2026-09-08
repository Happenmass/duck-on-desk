def reward_environment(state, action, next_state):
    """Batch tensors on the training device. Velocity m/s, height m, upright [-1,1]."""
    import torch
    error = next_state['forward_velocity'] - next_state['target_speed']
    tracking = torch.exp(-error.square() / 0.04)
    upright = next_state['upright'].clamp(0, 1)
    alive = (next_state['height'] > 0.06).float()
    return tracking + 0.5 * upright + 0.5 * alive - 0.002 * action.square().sum(-1)
