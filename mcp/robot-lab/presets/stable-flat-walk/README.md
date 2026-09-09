# MPS 平地行走实测方案

本方案用于 2026-09-09 开发版的普通脚、平地、基础行走模型动作修正训练。
需要新版奖励状态 `heading_error` 和 `yaw_rate`；已安装的 1.0.0 尚无这两个字段。

## 训练页面默认值

| 参数 | 值 |
|---|---|
| 目标速度 | 0.25 米 / 秒 |
| 练习轮数 | 200 |
| 训练设备 | MPS |
| 评测推理设备 | MPS |
| 同时练习的机器人 | 8 |
| 每轮试跑步数 | 128 |
| 学习率 | 0.001 |
| 随机种子 | 2 |
| 3D 预览 | 可选；此次参数筛选关闭 |

2026-09-09 已将这套参数、`reward.py` 和 `strategy.py` 设为开发版新工作台及 MCP 机器人实验的默认值；已有工作台仍可保存自定义配置。

**复现时必须同时使用同目录 reward.py 和 strategy.py。** 不能只改上述数字而沿用旧奖励：旧奖励不约束方向，会把越走越偏的模型也评为进步。
奖励保留速度跟踪 1.0、直立 0.5、离地 0.5、动作惩罚 0.002，另外减去 `5.0 × 朝向误差²` 和 `0.02 × 转动速度²`；跌倒另由训练器扣 2 分。策略为基础行走模型加默认 61→64→14 修正网络，无需改网络结构。

每次 204,800 个真实环境步。PyTorch 运行于 Apple GPU，物理仍为 CPU MuJoCo；这里不宣称全部物理计算在 GPU 上。

## 通过 MCP 复现

在仓库根目录运行，Python 路径应指向已有的 PyTorch／MuJoCo 环境：

```sh
DUCK_LAB_PYTHON=/absolute/path/to/python node mcp/robot-lab/parameter-sweep.mjs mcp/robot-lab/presets/stable-flat-walk/run.json /tmp/duck-stable-training.json
```

脚本通过官方 MCP SDK 创建实验、写入三份文件、校验并启动真实训练。它不覆盖当前工作台草稿，不自动应用到桌宠。候选策略和检查点保存在用户级 Hugging Face 缓存，训练记录可在实验室中继续预览和评测。

实测数据与适用边界见仓库 `docs/diagnostics/training-parameters-2026-09-09/README.md`。CUDA 待 NVIDIA 实机验证。
