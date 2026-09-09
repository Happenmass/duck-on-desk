"""Posture reward v2: supported inversion, continuous hold, bounded exploration.

Edit the weights below. A headstand uses this robot's head, not imaginary arms.
No fixed joint-angle target: bent legs are allowed when the whole body balances.
"""


def reward_components(state, action, next_state):
    import torch
    s = next_state
    support = s['head_contact'] * (1-s['feet_contact']) * (1-s['body_contact'])
    legs = ((s['feet_above_base']-.02)/.06).clamp(0, 1) * ((s['feet_height']-.08)/.08).clamp(0, 1)
    alignment = torch.exp(-(s['support_offset']/.035).square())
    inversion = (-s['upright']).clamp(0, 1).square()
    stability = torch.exp(-2*s['angular_speed'].square()
                          -50*s['horizontal_speed'].square()-.1*s['joint_speed'].square())
    within_limits = (s['joint_limit_margin'] >= -.02).float()
    posture = support * legs * alignment * inversion * stability * within_limits
    # A full turn cannot collect this again: at most 0.5 per eight-second episode.
    progress = (s['best_inversion']-state['best_inversion']).clamp(0, 1)
    # Environment resets this timer immediately on losing any success condition.
    hold = (s['hold_seconds']/2).clamp(0, 1)
    motion_cost = (.02*(s['angular_speed']-2).clamp(0, 5).square()
                   +.01*s['horizontal_speed'].square().clamp(max=4)
                   +.005*s['joint_speed'].square().clamp(max=100)
                   +.05*((.05-s['joint_limit_margin'])/.05).clamp(0, 2).square())
    command_cost = (.0002*action.square().sum(-1)
                    +.005*(action-state['previous_action']).square().sum(-1))
    return {
        'posture': 3.0*posture,
        'hold': 2.0*hold,
        'progress': .5*progress,
        'body_contact': -.1*s['body_contact'],
        'motion': -motion_cost,
        'command': -command_cost,
    }


def reward_environment(state, action, next_state):
    return sum(reward_components(state, action, next_state).values())
