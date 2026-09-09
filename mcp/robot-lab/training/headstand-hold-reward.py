"""Lesson 2: balance from a near-headstand start, not a learned entry motion."""
def reward_components(state, action, next_state):
    import torch
    s = next_state
    inversion = (-s['upright']).clamp(0, 1)
    alignment = torch.exp(-(s['support_offset'] / 0.04).square())
    # Angle between the trunk's up axis and world down: 0 means upright-inverted.
    # Reward body balance, not a prescribed combination of joint angles.
    tilt = torch.acos((-s['upright']).clamp(-1, 1))
    body_angle = torch.exp(-(tilt / 0.5).square())
    legs = ((s['feet_above_base'] - 0.01) / 0.07).clamp(0, 1)
    # Add dense signals near the goal; don't multiply all success conditions.
    posture = inversion * (0.5 + 0.5 * alignment + 0.5 * body_angle + 0.5 * legs + 0.5 * s['head_contact'])
    hold = 2.0 * (s['hold_seconds'] / 2.0).clamp(0, 1)
    # Feet may touch down or push off to regain balance. Reward the resulting
    # body balance, not the foot contact itself; lying on the body still costs.
    contact = -0.5 * s['body_contact']
    motion = (-0.03 * s['angular_speed'].square().clamp(max=25)
              -0.1 * s['horizontal_speed'].square().clamp(max=4)
              -0.005 * s['joint_speed'].square().clamp(max=100)
              -0.05 * ((0.05-s['joint_limit_margin']) / 0.05).clamp(0, 2).square())
    command = -0.01 * (action-state['previous_action']).square().sum(-1)
    return dict(posture=posture, hold=hold, body_contact=contact, motion=motion, command=command)


def reward_environment(state, action, next_state):
    return sum(reward_components(state, action, next_state).values())
