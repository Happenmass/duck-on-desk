# 第一课默认值：官方 mjlab Velocity 任务

2026-09-11 起，行走课不再运行本地 CPU MuJoCo PPO，而是把官方仓库 `pollen-robotics/microduck_rl`（commit 53b8971，mjlab 1.3.0 / rsl_rl 5.0.1）的 `Mjlab-Velocity-Flat-MicroDuck` 任务原样嵌入应用：16 项奖励、域随机化、特权 critic、在线观测标准化、自适应 KL 的 PPO（lr 1e-3、5 epochs × 4 minibatch、entropy 0.01、init_std 1.0）与课程表全部沿用官方，策略从随机权重开始。

`reward.py` 只声明 `reward_weights`（官方奖励项 → 权重）；`strategy.py` 保留作说明，网络结构由官方配置决定。`environments` 默认 256 是为 Mac CPU 物理缩小的规模（官方 4096 × 24）；NVIDIA 机器请用「使用本机推荐参数」填回 4096。官方 `max_iterations` 为 50000，这里默认 200 只用于观察趋势。

训练前后的对比测试仍在应用自带的 CPU MuJoCo 环境里进行（3 个种子 × 250 步），与桌宠仿真一致。
