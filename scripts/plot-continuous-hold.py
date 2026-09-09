"""Plot the recorded experiment, without changing its metrics or training state."""
import json
import pathlib
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

root = pathlib.Path(__file__).resolve().parents[1]
output = root / '.release-reviews/continuous-hold-1000'
report = json.loads((output / 'mcp-run.json').read_text())
metrics = report['job']['metrics']
x = np.array([m['iteration'] for m in metrics])
font = FontProperties(fname='/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
plt.rcParams.update({'figure.facecolor': '#0d1821', 'axes.facecolor': '#0d1821',
                     'text.color': '#d5e4ec', 'axes.labelcolor': '#d5e4ec',
                     'xtick.color': '#91aab9', 'ytick.color': '#91aab9',
                     'axes.edgecolor': '#354c5c', 'font.size': 11})
fig, axes = plt.subplots(3, 1, figsize=(11, 10), sharex=True, layout='constrained')
fig.suptitle(f'连续不重置训练 · {x[-1]} 轮 · seed 2', fontproperties=font, fontsize=20)
axes[0].plot(x, [m['mean_reward'] for m in metrics], color='#6ddac5', linewidth=1)
axes[0].set_title('平均奖励：分数变化不等于学会倒立', fontproperties=font, loc='left')
for name, label, color in [('posture','身体姿态','#6ddac5'), ('hold','连续保持','#f1bd70'),
                            ('body_contact','身体触地','#e87a7e'), ('motion','运动代价','#8abced'),
                            ('command','指令变化','#b9a2db')]:
    axes[1].plot(x, [m['reward_components'][name] for m in metrics], label=label, color=color, linewidth=1)
axes[1].set_title('奖励分项（原始每轮均值）', fontproperties=font, loc='left')
axes[1].legend(prop=font, ncol=5, frameon=False, loc='upper left')
valid = np.array([m['headstand_valid_percent'] for m in metrics])
axes[2].plot(x, valid, color='#f1bd70', linewidth=1.3)
axes[2].scatter(x[valid > 0], valid[valid > 0], color='#f1bd70', s=20)
axes[2].set_title('严格倒立达标占比（%）', fontproperties=font, loc='left')
axes[2].text(.02, .88, '首轮包含系统设置的近倒立初态，不能算作学会恢复。',
             transform=axes[2].transAxes, fontproperties=font, color='#91aab9')
axes[2].set_xlabel('训练轮次', fontproperties=font)
for ax in axes:
    ax.grid(alpha=.15)
    ax.axhline(0, color='#91aab9', linewidth=.5)
    ax.spines[['top', 'right']].set_visible(False)
axes[-1].set_xlim(1, max(2, x[-1]))
fig.savefig(output / 'training-curves.png', dpi=150)
summary = {'run_id':report['job']['id'], 'phase':report['job']['phase'],
           'iterations':len(metrics), 'environment_steps':metrics[-1]['environment_steps'],
           'elapsed_seconds':metrics[-1]['elapsed_seconds'],
           'total_resets':sum(m['timeout_resets'] + m['failure_resets'] for m in metrics),
           'valid_iterations':[m['iteration'] for m in metrics if m['headstand_valid_percent'] > 0],
           'training_max_hold_seconds':max(m['headstand_max_hold_seconds'] for m in metrics),
           'windows':[]}
for start in range(0, len(metrics), 100):
    rows = metrics[start:start + 100]
    summary['windows'].append({'iterations':[rows[0]['iteration'], rows[-1]['iteration']],
        'mean_reward':float(np.mean([m['mean_reward'] for m in rows])),
        'mean_valid_percent':float(np.mean([m['headstand_valid_percent'] for m in rows])),
        'reward_components':{key:float(np.mean([m['reward_components'][key] for m in rows]))
                             for key in rows[0]['reward_components']},
        'mean_learning_rate':float(np.mean([m['learning_rate'] for m in rows]))})
(output / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary))
