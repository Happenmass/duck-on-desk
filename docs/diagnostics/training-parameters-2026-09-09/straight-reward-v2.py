def reward_environment(state, action, next_state):
    """Flat walking: track speed, stay upright and retain the initial heading."""
    import torch
    error = next_state['forward_velocity'] - next_state['target_speed']
    tracking = torch.exp(-error.square() / 0.04)
    upright = next_state['upright'].clamp(0, 1)
    alive = (next_state['height'] > 0.06).float()
    heading = next_state['heading_error']
    turning = next_state['yaw_rate']
    return (tracking + 0.5 * upright + 0.5 * alive
            - 0.002 * action.square().sum(-1)
            - 5.0 * heading.square() - 0.02 * turning.square())
