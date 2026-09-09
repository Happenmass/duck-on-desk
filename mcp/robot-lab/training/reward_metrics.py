"""Optional decomposition of the actual reward, evaluated once per rollout batch."""
import torch


def reward_breakdown(component_fn, states, actions, next_states, actual_rewards, automatic_penalties):
    if component_fn is None:
        return {'reward_breakdown_status': 'not_provided'}
    try:
        before = {k:torch.cat([s[k] for s in states]) for k in states[0]}
        after = {k:torch.cat([s[k] for s in next_states]) for k in next_states[0]}
        actual = torch.cat(actual_rewards)
        components = component_fn(before, torch.cat(actions), after)
        if not isinstance(components, dict) or not components or len(components) > 32:
            return {'reward_breakdown_status': 'invalid'}
        if any(not isinstance(k, str) or not isinstance(v, torch.Tensor) or v.shape != actual.shape
               or not torch.isfinite(v).all() for k,v in components.items()):
            return {'reward_breakdown_status': 'invalid'}
        if not torch.allclose(sum(components.values()), actual, atol=1e-5, rtol=1e-4):
            return {'reward_breakdown_status': 'inconsistent'}
        return {'reward_breakdown_status': 'verified',
                'reward_components': {k:float(v.mean().cpu()) for k,v in components.items()},
                'automatic_penalty': float(torch.cat(automatic_penalties).mean().cpu())}
    except Exception:
        # A logging helper must not replace or break an otherwise valid custom reward.
        return {'reward_breakdown_status': 'invalid'}
