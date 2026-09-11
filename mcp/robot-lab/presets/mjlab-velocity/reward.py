# 第一课使用官方 mjlab 环境 Mjlab-Velocity-Flat-MicroDuck 的 16 项奖励。
# 这里只决定每一项的权重；奖励本身的计算方式与官方仓库 microduck_rl 完全一致。
# 删掉某一行，该项就沿用官方默认权重。
reward_weights = {
    'track_linear_velocity': 2.0,   # 跟上前进 / 侧移速度指令
    'track_angular_velocity': 2.0,  # 跟上转向速度指令
    'upright': 2.0,                 # 身体保持直立
    'pose': 1.0,                    # 关节靠近默认站姿
    'head_pose_tracking': 2.0,      # 头部跟随姿态指令
    'body_pose_tracking': 0.0,      # 躯干姿态指令（官方默认关闭）
    'air_time': 3.0,                # 鼓励迈步腾空
    'foot_clearance': -2.0,         # 抬脚不够高扣分
    'foot_swing_height': -0.25,     # 摆动腿高度偏离目标扣分
    'foot_slip': -0.1,              # 支撑脚打滑扣分
    'body_ang_vel': -0.05,          # 身体乱转扣分
    'angular_momentum': -0.02,      # 全身角动量扣分
    'dof_pos_limits': -1.0,         # 关节顶到极限扣分
    'self_collisions': -1.0,        # 自碰撞扣分
    # 下面两项官方按课程表随训练步数逐步调整（action_rate_l2：−0.1 → −1.0，
    # head_pose_bias：0 → 3.0）。写出权重后即改为固定值，不再自动调整。
    # 'action_rate_l2': -0.1,       # 相邻两拍动作变化扣分
    # 'head_pose_bias': 0.0,        # 头部姿态长期偏差扣分
}
