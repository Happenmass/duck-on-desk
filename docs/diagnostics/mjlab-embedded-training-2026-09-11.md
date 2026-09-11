# 官方 mjlab 训练嵌入 Robot Lab（2026-09-11）

## 结论

- 第一课「行走」不再运行自研 CPU-MuJoCo PPO。应用直接嵌入官方 `pollen-robotics/microduck_rl`（commit `53b8971b61baf5b7f3c16d135dd7cac37623de4b`，mjlab 1.3.0 / rsl_rl 5.0.1）的 `Mjlab-Velocity-Flat-MicroDuck` 任务：16 项奖励、域随机化、76 维特权 critic、在线观测标准化、自适应 KL 的 PPO（lr 1e-3、5 epochs × 4 minibatch、entropy 0.01、init_std 1.0）与课程表全部沿用官方，策略从随机权重开始。
- 两台机器同一套交互：Mac 上物理在 CPU（MuJoCo Warp 没有 Metal 后端）、网络在 MPS；NVIDIA 上走官方 CUDA。设备选择仍由界面里的「用哪个设备训练」决定。
- 驱动 `mcp/robot-lab/training/train_mjlab.py`（约 200 行）：加载官方 env/agent cfg → 套用界面参数（环境数、每轮步数、学习率、轮数、种子、奖励权重）→ 官方 runner 训练 → 钩住 rsl_rl 的 `Logger.log` 按现有 JSONL 格式吐指标 → 官方 `export_policy_to_onnx` → 用应用自带 CPU MuJoCo 环境做训练前后对比 → manifest / preview.json 与旧格式一致。
- 环境安装 `setup.cjs`：`git clone` 钉死 commit → `uv sync --frozen`（用仓库自带 uv.lock，venv 放在 `~/.duck-on-desk/training-runtime/py312-mjlab-<backend>`）→ Windows CUDA 额外把 torch 换成 cu128 wheel（PyPI 的 Windows torch 是纯 CPU）。倒立课程继续使用同一个 venv 里的 CPU MuJoCo 路径。

## 本机实测（Apple Silicon，MPS）

| 环境数 | 每轮样本 | 采样（Warp CPU） | 更新（MPS） | 每轮 |
| --- | --- | --- | --- | --- |
| 64 | 1,536 | 3.2 s | 0.2–0.5 s | ≈3.7 s |
| 256 | 6,144 | 9.65 s | 0.2–1.2 s | ≈11 s |

- 瓶颈是 Warp 的 CPU 物理，约 640 env-steps/s，与环境数线性。256 环境 × 200 轮约 37 分钟；官方 4096 × 24 在 Mac 上每轮约 150 s，不适合复现规模，Mac 只做流程与配置验证，复现在 NVIDIA 机器。
- 首次运行 Warp 编译约 20 s。环境安装：克隆 12 s、`uv sync` 1.5 s（uv 缓存已热）、首次探针 83 s（导入 torch/warp/mjlab 首次编译）。
- 导出 ONNX 与 rsl_rl 策略的最大偏差 1.8e-7；图结构 `Sub/Div/Gemm/Elu/Gemm/Elu/Gemm/Elu/Gemm`，输入 `obs`、输出 `actions`，桌宠运行时与 `BasePolicy` 零改动加载。
- 续训：检查点为 rsl_rl 格式并附带 `environment_steps` 与 `common_step_counter`（课程表进度）。2 轮后续训 1 轮，迭代号 2→3、步数 3,072→4,608 连续。
- 实时预览：从 mjlab 场景读 root 位姿 + 契约顺序的 14 个关节，沿用 LivePreview 的 10 fps 限流；帧内容与 CPU 环境一致（root z 0.116，四元数 wxyz）。
- 通过 `jobs.cjs` 走完整应用路径（准备环境 → 启动 → 训练 → 评测 → 导出）：2 轮 / 64 环境 39 s 完成，候选策略 fall_rate 1.0、不通过准入——随机策略的预期结果，不是故障。

## 界面与配置变化

- 第 2 步的奖励编辑框对行走课改为 `reward_weights` 字典（模板 `training/mjlab-velocity-reward.py`，列出官方 16 项默认权重）；三个滑块映射到 `track_linear_velocity`、`upright`、`action_rate_l2`。`action_rate_l2` 与 `head_pose_bias` 官方由课程表调整，一旦写出权重即固定并在 manifest 记录 `curricula_disabled`。
- 「新训练的起点」「PPO 更新方式」对行走课隐藏并固定为官方（随机权重、`mjlab-official`）；倒立课程不变。
- 行走课默认：256 环境 × 24 步、lr 0.001、seed 42、200 轮；「使用本机推荐参数」在 CUDA 下填回官方 4096。
- 旧 `workbench.json` 没有 `recipe: "mjlab-official"` 标记的一律忽略（旧奖励脚本是 `reward_environment` 函数，新驱动用不了）。
- MCP：`physics_backend` 新增 `"mjlab"`；行走草稿默认该值；`lab_experiment_validate` 接受只声明 `reward_weights` 的 reward.py。
- 旧管理环境 `py312-torch291-*` 不再使用，可以手动删除。

## 未验证

- NVIDIA / Windows 原生：智能应用控制拦截 `warp.dll`（WinError 4551）；WSL2 路线未接入应用。CUDA 分支只按官方脚本写法接了 `cuda:0`，未在实机跑过。
- 官方规模（4096 × 24 × 50000 轮）的训练结果没有在应用内跑过；本机只到 3 轮。

## 方法教训

- 「复现官方结果」的正确做法是把官方环境原样嵌入，界面只改规模与权重；重写一个"看起来一样"的环境永远对不齐（上一版 6 项奖励对官方 16 项）。
- rsl_rl 的 `learn()` 没有停止钩子；在 `Logger.log` 里抛异常是最小侵入的取消点，更新已完成、状态一致。
