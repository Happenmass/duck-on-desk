"""Lesson 2: keep coming back to head-down support after every tip-over.

The goal is not one long motionless headstand. Tipping over is expected and the
feet are the recovery actuator, so foot contact is never a cost here and there is
no hold timer a foot touch can reset. What is scored is how much of the time the
trunk is rotated head-down over its own head, and how often the duck gets back
there after going down.

A pose reward on its own always has a cheap static solution, and this model has
two good ones: propped on head and feet at upright -0.34, and folded onto its
head at 4 cm, which is MORE inverted than the pose we actually want. Both are
priced below zero here, and the recovery pulse is the term neither can collect.
"""
def reward_components(state, action, next_state):
    import torch
    s, p = next_state, state
    # Saturates at -0.8, the deepest a controller sustains. Rewarding ever deeper
    # rotation is what kept ranking the fold (-0.92) above the target pose (-0.80):
    # past the achievable angle, more inversion means collapsed, not better. Cubed
    # below that, so there is still gradient up from a duck propped at -0.34.
    inverted = ((-s['upright']) / 0.8).clamp(0, 1)
    # Trunk height is the only thing separating the fold from the target pose, so
    # ramp across exactly the band that divides them: the fold sits at 4 cm and a
    # planner sustains about 8 cm. The 15.5 cm reference pose is a transient that
    # no controller holds, so requiring it would make the goal unreachable.
    lifted = ((s['height'] - 0.045) / 0.03).clamp(0, 1)
    goal = inverted.pow(3) * (0.4 + 0.6 * s['head_contact']) * lifted
    # Potential shaping over inversion and trunk height. The height half is what
    # gives a gradient up out of the fold, where goal is flat and the duck is
    # already inverted. Being a potential difference it telescopes to zero around
    # any closed cycle, so rocking or bobbing cannot farm it.
    def potential(upright, height):
        return 2.0 * (-upright).clamp(0, 1) + 6.0 * (height / 0.155).clamp(0, 1)
    shaping = 0.99 * potential(s['upright'], s['height']) - potential(p['upright'], p['height'])
    # One pulse per genuine return to head-down support, gated in the environment
    # by a wide hysteresis band so a wobble across one threshold does not count.
    # Roughly 0.2/step at one recovery every two seconds. This is what makes the
    # cycle beat standing still, and it is exactly the behaviour asked for.
    recovery = 20.0 * s['recovered']
    # Resting on the trunk is the failure state, not a place to settle.
    lying = -0.3 * s['body_contact']
    # Keep only what protects real servos. Deliberately no angular-speed tax: the
    # kick that rights the body needs exactly the motion the old reward charged for.
    effort = (-0.002 * s['joint_speed'].square().clamp(max=100)
              - 0.05 * ((0.05 - s['joint_limit_margin']) / 0.05).clamp(0, 2).square())
    command = -0.005 * (action - p['previous_action']).square().sum(-1)
    return dict(goal=goal, shaping=shaping, recovery=recovery, lying=lying,
                effort=effort, command=command)


def reward_environment(state, action, next_state):
    return sum(reward_components(state, action, next_state).values())
