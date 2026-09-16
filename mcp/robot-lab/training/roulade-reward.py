# 第二课：官方步态初始化，学习贴地前滚翻，不是腾空前空翻。
# 奖励函数、接地/头顶/侧滚判定直接采用官方 Roulade 环境。
# 未列出的项与课程表保留官方设置，避免持续直立奖励阻碍翻转。
reward_weights = {
    'roulade_progress': 8.0,          # 只支付新增的向前翻转进度
    'roulade_head_pivot': 0.5,        # 经过头顶支点，同时仍在向前转
    'roulade_landing_composite': 4.0, # 翻过后才奖励站姿、身高与直立
    'roulade_upright_after_roll': 1.5,
    'roulade_height_after_roll': 1.0,
    'roulade_landing_sharp': 2.0,
    'roulade_rise_velocity': 0.75,
    'roulade_sagittal': -0.1,         # 抑制偏离前滚翻平面
    'roulade_lateral_vel': -0.5,
    'roulade_flatness': -0.5,
    'roulade_overspeed': -0.1,
}
