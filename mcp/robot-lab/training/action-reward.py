def reward_environment(state, action, next_state):
    """Experimental headstand dance: enter, invert and hop, then stand again.

    This is a task definition, not a demonstrated successful training recipe.
    """
    import torch
    p = next_state['phase']
    enter = ((p - 0.05) / 0.2).clamp(0, 1)
    leave = ((p - 0.65) / 0.2).clamp(0, 1)
    inverted = enter * (1 - leave)
    target_up = 1 - 2 * inverted
    orientation = torch.exp(-2 * (next_state['upright'] - target_up).square())
    target_height = 0.12 + inverted * 0.04 * torch.sin(8 * torch.pi * p).clamp(0, 1)
    height = torch.exp(-((next_state['height'] - target_height) / 0.05).square())
    air = (1 - next_state['ground_contact']) * (next_state['upright'] < -0.7).float()
    return (3 * orientation + height + inverted * air
            - 0.03 * next_state['forward_velocity'].square()
            - 0.002 * action.square().sum(-1)
            - 0.05 * (action - state['previous_action']).square().sum(-1))
