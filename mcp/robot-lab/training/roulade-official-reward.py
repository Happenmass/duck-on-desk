# 官方前滚翻：完整评分配置（改动后为自定义实验，下一次训练生效）
# 来源 pollen-robotics/microduck_rl @ 53b8971b61baf5b7f3c16d135dd7cac37623de4b
# 每项贡献 = 原始评分 × 权重 × 控制步时长；不同评分量纲不同，不能只比权重大小。
# 正权重不一定加分！stand_tax 和 gentle_landing 的函数本身返回负值。
reward_weights = {
    # 一、翻过去：只奖励真实前滚进展，躺着不动不能持续刷进度分。
    'roulade_progress': 8.0,          # 接地且朝前的新翻转进度
    'roulade_head_pivot': 0.5,        # 翻转中用头部作支点（含头顶接触判定）
    'roulade_overspeed': -0.1,        # 惩罚翻转过快，避免猛烈甩动
    # 二、起身站稳：按翻转进展门控，不在起步时阻止低头翻身。
    'roulade_landing_composite': 4.0, # 完成后的综合落地姿态
    'roulade_upright_after_roll': 1.5,# 翻转后的直立程度
    'roulade_height_after_roll': 1.0, # 翻转后恢复站立高度
    'roulade_landing_sharp': 2.0,     # 更严格的落地站立评分
    'roulade_stand_tax': 5.0,         # 正权重 × 负的高度欠缺：惩罚不起身
    'roulade_rise_velocity': 0.75,    # 收尾阶段鼓励向上起身
    # 三、别歪：限制侧滚、侧移，鼓励在前后竖直平面内翻滚。
    'roulade_sagittal': -0.1,         # 非前滚方向的旋转惩罚
    'roulade_lateral_vel': -0.5,      # 横向移动惩罚
    'roulade_flatness': -0.5,         # 偏离前后翻滚平面的惩罚
    # 四、平滑与身体约束：部分项随训练逐步增强，见下方课程表。
    'body_ang_vel': -0.002,          # 身体角速度；刻意很小，避免阻止翻滚
    'angular_momentum': -0.001,      # 角动量惩罚
    'dof_pos_limits': -1.0,          # 关节越界惩罚
    'action_rate_l2': -0.1,          # 相邻动作变化；动态权重
    'joint_torque_rate_l2': 0.0,     # 力矩突变；后期启用
    'arrival_damping': 0.0,          # 接近站立时抑制摇晃；后期启用
    'gentle_landing': 0.002,         # 正权重 × -|竖直加速度|：减轻冲击
    'self_collisions': -0.1,         # 轻微自碰撞惩罚，允许收腿团身
}

# 动态项：修改初始权重时，也要修改对应 step=0 的 weight，避免被课程表覆盖。
# 若要全程固定某项，删除下方该项的整条课程表，只保留上方 reward_weights。
# step 是每个环境累计的控制步数，不是并行样本总数。
# 默认每轮 24 步：1500*24 对应约第1500轮；改采样步数后轮数随之变化。
# 以下完整保留官方四项奖励课程表；其他环境/起步课程仍由官方源码管理。
reward_schedules = {
    'action_rate_l2': [
        {'step': 0, 'weight': -0.1},
        {'step': 1500 * 24, 'weight': -0.2},
        {'step': 3000 * 24, 'weight': -0.4},
    ],
    'joint_torque_rate_l2': [
        {'step': 0, 'weight': 0.0},
        {'step': 2500 * 24, 'weight': -0.0005},
        {'step': 3500 * 24, 'weight': -0.001},
    ],
    'arrival_damping': [
        {'step': 0, 'weight': 0.0},
        {'step': 2500 * 24, 'weight': -0.025},
        {'step': 3500 * 24, 'weight': -0.05},
    ],
    'gentle_landing': [
        {'step': 0, 'weight': 0.002},
        {'step': 2500 * 24, 'weight': 0.005},
    ],
}
