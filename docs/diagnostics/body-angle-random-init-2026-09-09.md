# 倒立保持：身体角度奖励与随机初始化（2026-09-09）

按用户最新纠正，将“复用官方网络结构”和“加载官方步态权重”分开。两课都用 61→512→256→128→14 / ELU、197,774 个可训练参数；第一课默认 official，第二课 microduck-headstand-hold 默认 random，界面“新训练的起点”允许显式对照。此决策替代此前“两课均从步态权重微调”的要求。

## 实现

- random 对每个 Linear 调用 PyTorch reset_parameters，权重／偏置随机，输出层非全零，受任务种子控制。输入 mean=0／scale=1，不带入步态统计；官方模式仍保留上游全部权重和标准化。最终 ONNX 保存训练使用的输入处理。
- 官方模型仍作为架构核验与评测参照，未被当作随机网络的初始参数。随机记录明确 training_method=random-actor-ppo-v1、initial_policy_sha256=null、policy_initialization=random、input_normalization=identity；starting_actor_sha256 核对本段实际起点，reference_policy_sha256 只标识比较模型。
- 续训恢复源权重、标准化、critic、Adam、累计计数、探索日程及可用的仿真／随机状态，忽略当前新训练默认。旧官方检查点与随机检查点都可续训；旧无 initialization 字段的 MCP 草稿保持官方初始化，避免改写既有实验含义。
- 保持奖励移除 exp(-reference_joint_error/.04) 固定关节姿态项，替换为身体角度 exp(-(θ/.5)^2)，θ=acos(-upright)，即身体轴与竖直倒置方向的夹角，单位弧度。仍结合支撑对齐、腿部离地、接触状态、连续保持、实际运动与动作平滑度。
- 不新增关节输出裁剪，控制目标仍为 DEFAULT_POSE + actor output，保留 MJCF 原有角度／力矩边界。腿可以在模型范围内调节平衡；稳定性不是匹配一组关节角。
- 网络随机与物理初态分开：仍从物理采样的近头撑姿态、带轻微速度扰动起步。参考姿态只用于初态；reference_joint_error 字段留给旧奖励脚本兼容。当前练的是保持，不是从站立自主翻转。

## 验证与效果边界

25 Python：原官方网络等值、随机种子复现／种子变化、每层随机且非全零、neutral normalization、不同参考关节误差奖励相同、身体越接近竖直倒置奖励越高、CPU／MPS 等值、检查点恢复等通过。5,861 Node 通过，15 原有跳过；3 MCP 通过。

公开 MCP：新随机倒立任务 run_cebc3fc8-da14-45f1-b0c4-f755428799ce 完成 5 轮／5,120 步，随后 run_56f7eb17-1f1e-482c-a26b-98c4d639dc54 追加 3 轮，共 8 轮／8,192 步。两次都 MPS。独立读取 checkpoint 核对：续训 starting_actor_sha256 与源 checkpoint actor 逐字节哈希一致，Adam 更新次数 20→32，mean=0／scale=1 保持。导出误差约 2.79e-8／4.47e-8。

源码与真实 app.asar 窗口：第一课官方／第二课随机默认、身体角度奖励、继续按钮、真实 MPS 续训、随机 ONNX 的 WASM 评测通过。旧官方两课检查点 20→21 轮续训再次通过。未应用桌宠策略或访问实体。

**尚未训练成功。** 随机 5／8 轮原生评测的最长保持最小值均 .08 秒，包内另一次 5→6 轮候选 WASM .06 秒，结尾均 0。此处验证实现和恢复正确，不证明随机初始化胜过预训练，也不证明当前探索幅度／预算足够。

## 安装与使用

本地 1.1.0 更新到 /Applications/Duck on Desk.app，未自动启动，原 97 个实验室数据文件保持不变。签名、ZIP CRC、无权重／pyc 入包及关键资源哈希检查通过；最终 ZIP 哈希见 .release-reviews/v1.1.0/artifact.json，安装核验见 .release-reviews/body-angle/installation.json。Git 未暂存、提交、推送或发布。

启动：应用程序 → Duck on Desk → 设置／关于 → 打开开发者模式 → 训练与策略。新方案选第二课和随机权重后新建；续训在右侧选记录、填写追加轮数、点击继续。

用户旧任务 run_94115b42-ec3f-4504-be37-e31ef23915ed 已于 847 轮取消，旧进程未生成检查点，无法续训；本次未停止它。原两条官方 20 轮完成记录仍可续训，但会沿用原奖励和步态初始化来源。

证据目录 .release-reviews/body-angle：random-mcp.json、random-audit.json、ui/report.json、packaged/report.json、installation.json、测试日志。核心改动 policy.py／train.py／checkpoints.py／headstand-hold-reward.py、jobs.cjs／server.mjs、lab.html／lab.js／lab-lessons.js、脚本和文档。
