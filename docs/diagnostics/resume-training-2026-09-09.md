# Robot Lab 检查点续训（2026-09-09）

已实现源码与本地 1.1.0 安装包，现已替换 `/Applications/Duck on Desk.app`。用户旧版任务 `run_94115b42-ec3f-4504-be37-e31ef23915ed` 已在第 847 轮取消，未生成 checkpoint，不能续训；本次未停止它。安装前无活动任务／应用进程，97 个现有实验室数据文件哈希未变，签名与安装资源核对通过，未自动启动应用。

## 使用与恢复契约

实验室“训练与策略”右侧选记录 → 填追加轮数 → “继续这次训练”。左侧“从官方权重新建训练”仍从原始官方权重开始。MCP 新增 lab_training_resume({run_id, additional_iterations})；总计 16 个工具。新段最多 2,000 轮／2 小时，可反复追加，累计次数不受 2,000 限制。

续训另建 run，不修改原记录或原权重；继承奖励、网络、学习率、设备和采样配置。恢复 actor、critic、Adam、累计计数、原探索日程。新检查点还恢复 MuJoCo integration state、环境历史／姿态计数和 CPU／MPS／CUDA 随机状态；不会把已衰减探索幅度重新升高。加载时重建接触与传感器，跨重启轨迹不承诺逐位一致；自定义脚本的有状态全局变量不序列化。

每 10 轮、段结束和协作停止时原子保存 checkpoint.pt；停止完成当前整轮，异常退出恢复最近持久化检查点。曲线仅展示当前续训段，横轴及环境步数为累计值；原记录可独立查看。停止／失败的检查点可经 MCP 取回；ONNX 导出、动作检查、应用门槛仍要求完成训练段。

兼容旧官方全量微调检查点（包括最早缺失 training_method 标签的一批），严格校验 actor 参数名与层尺寸。旧检查点恢复模型／优化器但重置仿真初态。旧修正网络、缺失／篡改检查点、非终止源任务、变化的任务／配置／机器人均拒绝续训。

## 真实验证

- MCP 行走：12 轮完成 → 追加 3 轮 = 15 轮；768→960 环境步；Adam 更新 48→60。
- MCP 倒立保持：100 轮任务在周期保存后请求停止，完成并保存第 11 轮 → 追加 3 轮 = 14 轮；704→896 步；Adam 更新 44→56；探索日程仍为原 100 轮。
- 原始两课官方 20 轮检查点：分别追加 1 轮，累计 21 轮／21,504 步，Adam 均为 84 次更新。历史源文件仅只读；测试元数据隔离，所有新权重在用户级 HF 缓存。
- 源码与实际 app.asar 界面都点击“继续这次训练”完成真实 MPS 训练：按钮可用状态、源记录、累计计数、进度 100%、原检查点未变通过；未激活桌宠策略或访问实体。
- Python 在 CPU／MPS 核对模型下一次更新、优化器计数、仿真 integration state、随机状态与旧格式恢复；原恢复测试发现传感器在 mj_forward 后刷新，与 mj_step 留下的上一积分阶段派生值不同，测试按同一观测核对学习与下一步积分，不作逐轨迹相等承诺。
- 5,861 Node 通过／15 项原有跳过；23 Python、3 MCP 通过；git diff --check 通过。
- Renderer 构建、ZIP CRC、签名、包内关键资源哈希通过；包内无 ONNX 权重与 Python 字节码。CUDA／Windows 仍待实机。

## 产物与边界

候选 ZIP：`dist/local-1.1.0/Duck-on-Desk-1.1.0-arm64.zip`，136,282,596 字节，SHA-256 `4e9028c0197819ba5b75b72160b50a79adde4d84d59c70e7611cb7ad4fc3742a`。续训版已安装，证据 `.release-reviews/resume-training/installation.json`；未自动启动应用，Git 未提交或推送。

主要改动：training/checkpoints.py、train.py、jobs.cjs、server.mjs；Electron/Vite 路由；lab.html/js/css；用户指南与 MCP 文档；检查点与任务回归、真实 MCP／界面测试脚本。未暂存、提交、推送或发布 Git。

证据：`.release-reviews/resume-training/` 下 mcp.json、legacy.json、optimizer-audit.json、ui/report.json、packaged/report.json、artifact.json 和测试日志。首轮历史兼容测试发现旧官方 checkpoint 缺方法标签，修正后两课重跑通过；保留失败测试任务以反映实际验证过程。

关节核对（2026-09-09）：当前 actor／训练／WASM 均未限制在参考角度 ±.2 rad，控制为 DEFAULT_POSE + 网络输出；模型原有 jnt.range 保留。保持奖励仍有 0.5×inversion×exp(-reference_joint_error/.04) 的固定参考姿态偏好，属于软奖励而非关节限位，本轮仅核对，未改奖励。
