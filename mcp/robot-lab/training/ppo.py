"""Versioned local PPO recipe; old checkpoints keep the original update path."""
import math
import torch
from torch import nn
from torch.distributions import Normal, kl_divergence

LEGACY = 'legacy-v1'
CURRENT = 'local-ppo-v2'


def recipe(config):
    profile = config.get('ppo_profile', LEGACY)
    if profile not in (LEGACY, CURRENT):
        raise ValueError('Unknown PPO profile')
    return dict(profile=profile, gamma=.99, gae_lambda=.95, clip=.2,
                epochs=5, minibatches=4, value_loss_coef=1., max_grad_norm=1.,
                desired_kl=.01, entropy_coef=.001) if profile == CURRENT else dict(profile=LEGACY)


class Exploration(nn.Module):
    def __init__(self, std):
        super().__init__()
        self.log_std = nn.Parameter(torch.full((14,), math.log(std)))

    def forward(self):
        return self.log_std.exp()

    def bound(self):
        # Bounds on sampling noise, not on joint motion or actor output.
        with torch.no_grad():
            self.log_std.clamp_(math.log(.01), math.log(.5))


def build_critic(config):
    if config.get('ppo_profile', LEGACY) == LEGACY:
        return nn.Sequential(nn.Linear(61, 64), nn.Tanh(), nn.Linear(64, 1))
    return nn.Sequential(nn.Linear(61, 512), nn.ELU(), nn.Linear(512, 256),
                         nn.ELU(), nn.Linear(256, 128), nn.ELU(), nn.Linear(128, 1))


def clipped_value_loss(values, old_values, returns, clip=.2):
    clipped = old_values + (values-old_values).clamp(-clip, clip)
    return torch.maximum((values-returns).square(), (clipped-returns).square()).mean()


def update(actor, critic, exploration, optimizer, observations, actions, old_logprob,
           old_values, returns, advantages, old_means, old_std, config):
    cfg = recipe(config)
    params = list(actor.parameters()) + list(critic.parameters()) + list(exploration.parameters())
    batch_size = observations.shape[0]
    totals = dict(policy_loss=0., value_loss=0., entropy=0., clip_fraction=0.)
    updates = 0; samples = 0
    for _ in range(cfg['epochs']):
        order = torch.randperm(batch_size, device=observations.device)
        for indices in torch.tensor_split(order, cfg['minibatches']):
            if not len(indices): continue
            distribution = Normal(actor(observations[indices]), exploration(), validate_args=False)
            with torch.no_grad():
                old = Normal(old_means[indices], old_std, validate_args=False)
                kl = float(kl_divergence(old, distribution).sum(-1).mean().cpu())
                if not math.isfinite(kl): raise ValueError('Non-finite PPO KL')
                lr = optimizer.param_groups[0]['lr']
                if kl > 2*cfg['desired_kl']: lr = lr/1.5
                elif 0 < kl < .5*cfg['desired_kl']: lr = min(config['learning_rate'], lr*1.5)
                for group in optimizer.param_groups: group['lr'] = lr
            ratio = (distribution.log_prob(actions[indices]).sum(-1)-old_logprob[indices]).exp()
            advantage = advantages[indices]
            policy_loss = -torch.minimum(ratio*advantage, ratio.clamp(.8, 1.2)*advantage).mean()
            value_loss = clipped_value_loss(critic(observations[indices]).squeeze(-1), old_values[indices], returns[indices])
            entropy = distribution.entropy().sum(-1).mean()
            loss = policy_loss + cfg['value_loss_coef']*value_loss - cfg['entropy_coef']*entropy
            if not torch.isfinite(loss): raise ValueError('Non-finite PPO loss')
            optimizer.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(params, cfg['max_grad_norm'])
            optimizer.step(); exploration.bound()
            n = len(indices); samples += n; updates += 1
            for key, value in [('policy_loss', policy_loss), ('value_loss', value_loss), ('entropy', entropy),
                               ('clip_fraction', ((ratio-1).abs() > .2).float().mean())]:
                totals[key] += float(value.detach().cpu())*n
    with torch.no_grad():
        final = Normal(actor(observations), exploration(), validate_args=False)
        kl = float(kl_divergence(Normal(old_means, old_std, validate_args=False), final).sum(-1).mean().cpu())
        prediction = critic(observations).squeeze(-1)
        variance = returns.var(unbiased=False)
        explained = float((1-(returns-prediction).var(unbiased=False)/variance).cpu()) if variance > 1e-8 else None
    return {**{k:v/samples for k,v in totals.items()}, 'approx_kl':kl, 'explained_variance':explained,
            'learning_rate':optimizer.param_groups[0]['lr'], 'optimizer_updates':updates,
            'minibatch_size':math.ceil(batch_size/cfg['minibatches']),
            'exploration_std':float(exploration().mean().detach().cpu())}
