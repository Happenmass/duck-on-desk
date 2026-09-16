"""Apply visible reward weights and optional explicit schedules; legacy numeric overrides stay fixed."""
import copy
import math


def apply_reward_config(cfg, namespace, curriculum_names):
    weights = namespace.get('reward_weights')
    schedules = namespace.get('reward_schedules', {})
    if not isinstance(weights, dict) or not isinstance(schedules, dict):
        raise ValueError('reward_weights 和 reward_schedules 必须是字典')
    def number(value):
        return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    for name, weight in weights.items():
        if name not in cfg.rewards or not number(weight):
            raise ValueError(f'未知奖励项或权重不是有限数字：{name}')
    for name, stages in schedules.items():
        key = curriculum_names.get(name)
        if name not in weights or key not in cfg.curriculum:
            raise ValueError(f'课程表需要对应的权重和官方课程项：{name}')
        if not isinstance(stages, list) or not stages:
            raise ValueError(f'课程表不能为空：{name}')
        previous = -1
        for stage in stages:
            if not isinstance(stage, dict) or set(stage) != {'step', 'weight'}:
                raise ValueError(f'课程阶段需要 step 和 weight：{name}')
            step = stage['step']
            if type(step) is not int or step <= previous or not number(stage['weight']):
                raise ValueError(f'课程步数须为递增的非负整数，权重须有限：{name}')
            previous = step
        if stages[0]['step'] != 0 or stages[0]['weight'] != weights[name]:
            raise ValueError(f'课程表须从 step=0 开始，首项权重须等于 reward_weights：{name}')
    disabled = []
    for name, weight in weights.items():
        cfg.rewards[name].weight = float(weight)
        key = curriculum_names.get(name)
        if name in schedules:
            cfg.curriculum[key].params['weight_stages'] = copy.deepcopy(schedules[name])
        elif key in cfg.curriculum:
            del cfg.curriculum[key]
            disabled.append(key)
    return disabled
