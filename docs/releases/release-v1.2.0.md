# Duck on Desk v1.2.0

第一课「行走」改为原样嵌入官方 mjlab 训练环境，应用内直接复现官方训练流程。

- 训练环境不再是自研的 CPU MuJoCo + 自定义 PPO，而是官方仓库 `pollen-robotics/microduck_rl`（commit `53b8971`，mjlab 1.3.0 / rsl_rl 5.0.1）的 `Mjlab-Velocity-Flat-MicroDuck` 任务：16 项奖励、域随机化、特权 critic、在线观测标准化、自适应 KL 的 PPO 与课程表全部沿用官方，策略从随机权重开始。
- 一套应用两种机器：Apple Silicon 上物理在 CPU（MuJoCo Warp 没有 Metal 后端）、网络在 MPS；NVIDIA 上走官方 CUDA。界面操作不变，仍由「用哪个设备训练」决定。
- 环境安装改为克隆钉死 commit 的官方仓库并按其 `uv.lock` 执行 `uv sync --frozen`，需要本机有 Git（macOS 装 Xcode 命令行工具，Windows 装 Git for Windows）。Windows CUDA 会额外把 torch 2.9.1 换成 cu128 wheel（PyPI 的 Windows torch 是纯 CPU）。
- 第 2 步的奖励编辑框对行走课改为 `reward_weights` 权重字典，列出官方 16 项默认值；三个滑块对应 `track_linear_velocity`、`upright`、`action_rate_l2`。`action_rate_l2` 与 `head_pose_bias` 官方由课程表调整，一旦写出权重即固定，manifest 记录 `curricula_disabled`。
- 「新训练的起点」与「PPO 更新方式」对行走课隐藏并固定为官方配方；倒立课程不受影响，继续在同一个环境里跑 CPU MuJoCo 路径。
- 行走默认 256 环境 × 24 步、学习率 0.001、seed 42、200 轮；CUDA 下「使用本机推荐参数」填回官方 4096 × 24。旧 `workbench.json` 的行走设置一律忽略。
- 训练指标新增每回合平均时长、完成回合数、学习率、动作标准差、各损失项与官方逐项奖励分解；检查点为 rsl_rl 格式并附带环境步数与课程表进度，续训后轮数与步数连续。
- 官方导出的 ONNX（标准化已烘焙进图）由桌宠运行时零改动加载；训练前后的对比测试仍在应用自带的 CPU MuJoCo 环境里进行。
- MCP：`physics_backend` 新增 `"mjlab"`，行走草稿默认该值；`lab_experiment_validate` 接受只声明 `reward_weights` 的 reward.py。

本机（Apple Silicon）实测：Warp CPU 物理约 640 env-steps/s，256 环境每轮约 11 s，200 轮约 37 分钟，只适合验证流程与配置；官方规模（4096 × 24 × 50000 轮）需在 NVIDIA 机器复现。CUDA 分支按官方脚本接入 `cuda:0`，**尚未在实机验证**。Windows 11 开启「智能应用控制」的机器会拦截 `warp.dll`（WinError 4551），需关闭该功能（不可逆）或改用 WSL2；两者都未接入应用。

实测数据与未验证项见 `docs/diagnostics/mjlab-embedded-training-2026-09-11.md`。
