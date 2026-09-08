> 后续完整实现与真实训练已完成，见 [首版实测](implementation.md)。下文保留此前设备探针的历史口径。

# Robot Lab MCP 首轮测试 · 2026-09-08

通过官方 MCP SDK 客户端连接独立 stdio 服务，完成 8 个工具的发现、3 个资源的发现与读取，以及 25 次工具调用。测试命令 `npm --prefix mcp/robot-lab test`，设置 `DUCK_LAB_PYTHON` 为本机 playground 的 PyTorch 2.9.1 环境；协议集成测试通过。

| 验证项 | 结果 |
|---|---|
| 文档搜索／读取、资源读取 | 通过 |
| 奖励、策略网络、训练配置经 MCP 写入 | 通过，返回 revision 与 SHA-256 |
| 旧版本写入／执行、非法 ID | 正确拒绝 |
| 配置错误、Python 语法错误、奖励形状错误 | 正确识别；语法通过不代表运行通过 |
| CPU 合成更新＋推理 | 通过，3 次优化器更新，输出 [16,14] |
| MPS 合成更新＋推理 | 通过，参数／推理均在 MPS，无 CPU fallback |
| CUDA | 本机不可用时正确报错；CUDA 实机训练／推理仍待验证 |
| 真实机器人环境、PPO、导出、桌宠应用 | 本轮未实现，环境步数 0 |

原始证据：[first-round.json](first-round.json)。复现入口：[first-round.mjs](../../../mcp/robot-lab/first-round.mjs)，包含本轮 Agent 通过 MCP 写入的脚本正文。测试使用临时实验目录并清理，不改 App、基础策略或用户 Agent 配置；没有提交云任务。

本轮只证明 MCP 调用、脚本契约与模型设备执行路径。合成损失下降不能证明机器人会走路，也不能证明实际强化学习更快。MPS 与 CPU 的随机输入不要求一致，本报告不作数值等价或性能比较。
