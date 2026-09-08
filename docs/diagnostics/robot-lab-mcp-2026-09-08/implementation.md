# Robot Lab 首版实测，2026-09-08

已完成完整机器人实验室、真实训练与策略导回。当前是开发代码，未发布到现有 v0.2.3 Release。

## 实现

- 设置 → Agent 管理 → 打开机器人实验室。独立不透明窗口，可缩放、不置顶；完整 3D 机器人、地面、轨道相机、运行／暂停／单步、14 关节检查和目标控制。
- 奖励脚本、策略网络、设备与 PPO 参数可编辑；真实采样进度和奖励曲线、历史任务、取消、候选预览、双侧评测、ONNX＋manifest 导出、应用和恢复上一策略。
- Agent 页原有 MCP 安装功能保留。MCP 现有 14 个工具和 3 个资源；版本化草稿与真实训练任务共用同一后端。
- Python CPU MuJoCo＋PyTorch MPS/CUDA/CPU。训练与评测推理设备分别指定；桌宠及实验室预览仍用 Web WASM。策略权重保存到用户级 Hugging Face 缓存，不写入源码或安装包。

## 真实证据

| 检查 | 结果 |
|---|---|
| 页面启动 MPS 训练 | 20 轮，2,560 个真实环境步，完成 |
| MCP 写入奖励／策略并启动 MPS | 23 次工具调用，20 轮、2,560 步；参数 L1 变化 28.5164 |
| ONNX 数值校验 | 基础策略导入与新策略导出最大误差均 2.68221e-7 |
| 原生评测 | 3 个种子环境各 250 步，无跌倒；速度 MAE 0.1483495 → 0.1482868 m/s |
| 浏览器评测 | 两个策略各 250 步，无跌倒；速度 MAE 0.1483230 → 0.1482994 m/s |
| Electron 真实应用 | 实验室 IPC → 实际 pet preload → 共享 DuckRuntime 加载新 ONNX，控制 50 Hz／绘制 30 fps |
| 导出／回退／重开 | 导出 813,450 字节 ONNX＋manifest；恢复基础策略；关闭并重开实验室正常 |
| 取消 | MCP 新任务在轮次边界实际停止 |
| 全量 Node 测试 | 5,852 项：5,837 通过、0 失败、15 跳过 |
| MCP 协议回归 | CPU／MPS 合成探针、版本冲突、错误输入及不可用 CUDA 拒绝通过 |
| macOS arm64 dir 构建 | 构建成功；包内 MCP 启动发现 14 工具；解包 MJCF 可由原生 MuJoCo 加载，61 维观测、14 执行器，模型哈希一致 |

原始证据：`real-training.json`、`browser-evaluation.json`、`electron-integration.json`。`first-round.json` 是此前只有设备探针的历史报告；不将其当作真实训练。

首轮训练奖励与速度误差变化很小，仅证明真实学习、导出和应用链路有效，不证明获得了更好的步态。首版仅平地普通脚、walk 策略；检查点保存 actor/critic/optimizer，尚未接入自动续训或其他 RL 算法。CUDA 明确待 NVIDIA 实机验证，Windows 窗口也未在实机验收。

Electron 验证用隔离的虚拟渲染测试进程、独立临时用户目录，不加载 src/main.js、实体适配器或 Agent hooks。用户主应用及实体机器人没有启动。用户原有激活状态保持基础策略；可从训练历史重新选择候选。

复现：先 `npm run build:renderer`；设置已有 Python 环境后运行 `node mcp/robot-lab/training-round.mjs`；浏览器实测候选并保存报告，再用 `node_modules/.bin/electron scripts/smoke-robot-lab-electron.cjs` 验证实际 IPC/加载/导出/回退。开发界面可用 `npm run dev:lab` 单独启动。
