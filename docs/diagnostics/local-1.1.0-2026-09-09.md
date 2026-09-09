# 1.1.0 本地安装验证（2026-09-09）

已将工作区的机器人实验室改动打成 macOS arm64 本地 1.1.0，并替换 `/Applications/Duck on Desk.app`。旧 1.0.0 进程已正常退出，新主进程未自动启动；验证仅使用隔离的设置／虚拟实验室与 Python 训练进程，没有启动实体连接。

## 内容与配置

- 14 路中文关节映射、半透明 3D 与即时摆姿。
- 四步训练教程、奖励和两种 loss 曲线、默认关闭的真实训练 3D 预览。
- UI／MCP 默认使用已验证的 MPS 方案：0.25 m/s、200 轮、8 环境、128 步、lr=0.001、seed=2，含方向惩罚；仍可保存自定义参数。
- 模型复用用户级 Hugging Face 缓存，本地 ZIP 无 ONNX 权重。现有训练记录、workbench 与模型激活文件哈希核对一致，没有自动应用新策略。

## 验证结果

- 5,846 个 Node 测试通过、15 跳过；版本／署名校验与 Renderer 构建通过。
- 仓库资产审计无错误；现有 MCP 类型声明重复告警保留。
- 使用实际 app.asar 的 About／开发者开关／实验室打开关闭测试通过，About 显示 1.1.0；包内八个训练字段和两份脚本与实测参数包一致。
- 使用包内 MCP 创建实验、读取文档、校验脚本并进行 MPS 训练／推理／ONNX 导出。此次路径冒烟为 2 轮、2 环境、8 步，共 32 个真实环境步，不作为新的步态质量结论；200 轮质量证据仍见 [原训练报告](training-parameters-2026-09-09/README.md)。临时训练任务和权重已清理。
- 安装后的 MCP 初始化发现 14 个工具，原生 arm64 文件审计及 codesign 验证通过。
- 包内训练首次复现签名失效：Python 新增 `training/__pycache__/*.pyc`。训练入口增加 `-B`，重打包后再次真实训练，确认无字节码缓存且训练后签名通过。旧包回归失败记录与新包通过记录保存在 `.release-reviews/v1.1.0/`。

## 本地产物

- 当前 ZIP：`dist/local-1.1.0/Duck-on-Desk-1.1.0-arm64.zip`，136,254,452 bytes，CRC 通过（Dock 修复已在用户终止训练后安装）。
- SHA-256：`467d22744450262e1d974f739b3f8fbd2dae473f36e9f26254e79a2990c6721f`。
- 回退 ZIP：`dist/Duck-on-Desk-1.0.0-arm64.zip`，原包 CRC 已复核。替换过程的暂存应用已移除。
- 详细报告：`.release-reviews/v1.1.0/` 下的 `artifact.json`、`installation.json`、`about/report.json`、`defaults-ui.json`、`packaged-mcp.json`、`native-audit.json` 及测试日志。

源码只在工作区修改，未暂存、提交、打标签、推送或发布；HEAD 仍为 `41134e170fdfc67c90fbee1d3f862de70accd48c`。版本改动在 `package.json`／`package-lock.json`，包内训练缓存修复在 `mcp/robot-lab/jobs.cjs`，发布清单和包检查脚本同步更新。CUDA 仍待 NVIDIA 实机验证。


## 镜头跟随修复（2026-09-09，同版本本地更新）

用户反馈「认识与控制」中的机器人走动时镜头不跟随。隔离 Electron 实测 0.25 m/s 指令、约 10 秒仿真后，可见关节标记从 14 个变为 0 个。原因是相机与 OrbitControls 的观察目标固定在起点，渲染仅更新机器人位置。

`lab-visuals.js` 现按 trunk 的世界坐标计算水平位移，同时平移相机与观察目标；在运行时写入本帧姿态后更新，避免坐标转换错误和一帧滞后。保留手动旋转、缩放与平移偏移，忽略迈步的竖直起伏；重置身体或切换预设视角后继续跟随。桌宠和训练现场预览的相机逻辑不变。

验证：两个使用真实 Three.js／OrbitControls 的回归用例先失败、修复后通过，覆盖坐标转换、重置、手动视角与四种预设。构建页面及实际 app.asar 的真实行走均维持 14 个关节可见；旋转缩放后再次走动、重置、正面／侧面／俯视也通过。完整 Node 回归 5,846 通过、15 跳过。

重新打包并替换 `/Applications/Duck on Desk.app`，仍为本地 1.1.0；签名与包资源一致性通过，训练记录、工作台与激活文件保持一致。旧 PID 17268 正常退出，新主进程未自动启动；未提交或推送 Git。测试入口 `scripts/smoke-lab-camera.cjs`，证据在 `.release-reviews/camera-follow/{before,after,packaged}/report.json` 及 `installation.json`。

## 本地追加：动作库与第二课

2026-09-09 已再次替换为包含动作菜单、站立衔接和第二课的同版本构建，安装签名／资源哈希已核验，主程序未自动启动。首轮倒立街舞未学会、未入动作库；细节与验证边界见 [动作测试](duck-actions-2026-09-09.md)。


## 本地追加：2,000 轮训练

2026-09-09：此前执行端最多 500 轮、30 分钟，现将两门课的 UI／MCP／执行端统一为 1–2,000 轮、单次最多 2 小时；默认仍为 200 轮。超时同时传入 Python 训练循环和主进程计时器，不会到 30 分钟仍被旧计时器终止。

验证：5,852 Node 测试通过、15 跳过，MCP 协议 3 项通过；模拟子进程验证两门课实际生成的训练配置为 2,000 轮／7,200 秒，父计时器为 7,200,000 ms。实际源码与包内 UI／IPC 验证接受 2,000、拒绝 2,001，MCP 验证两门课的 2,000 轮草稿。未启动 2,000 轮长训，不据此宣称倒立动作已学会。

本地 1.1.0 已替换，旧 PID 88283 正常退出；无训练任务运行，59 个现有实验室数据文件哈希一致。ZIP CRC／无权重与字节码／安装签名及资源哈希通过；新主程序未自动启动，Git 未暂存或提交。证据：`.release-reviews/training-2000/` 下的 `source/report.json`、`packaged/report.json`、`full-tests.log`、`mcp-tests.log`、`installation.json`。


## 已准备、未安装：自定义 Reward 入口

2026-09-09：用户反馈第二课看不到自定义 Reward。实测 `scripts/smoke-lab-reward-editor.cjs` 在第 2 步得到 `editor.visible=false`；脚本和 IPC 均存在，根因是编辑框折叠在“看看评分规则如何写成代码”下，且第二课不显示行走奖励滑块。

修正版直接显示「自定义奖励（Reward）」编辑框，第 3 步可一键跳回并聚焦；新增状态字段说明和默认 8 秒时间表／奖励权重。源码 `action-reward.py` 没有修改，当前训练任务的奖励也没有改变。编辑草稿只影响下一次启动的任务。

原脚本同一路径修复后通过：源码及 app.asar 内编辑框可见、两课程草稿隔离、往返切换保留自定义内容、实际训练 IPC 携带完整编辑脚本；在启动执行前截获参数，没有启动新的训练。1,440 与 1,000 px 宽度无横向溢出，编辑器及评分表截图已检查。5,852 Node 测试通过、15 跳过，构建／ZIP CRC／无 ONNX 与 pyc／包签名通过。证据 `.release-reviews/reward-editor/`：`before/report.json`、`source/report.json`、`packaged/report.json`、`full-tests.log`、`artifact.json`。

检查时用户的 `run_fe71dba3-f35e-46d9-8e87-14441f7d3f2f` 正在 MPS 跑第二课 2,000 轮，使用原默认 Reward。因此未退出或替换 `/Applications/Duck on Desk.app`，本轮只准备好 `dist/local-1.1.0/` 中的同版本构建。不要将打包通过记为已安装；尚未取得这次长训的最终动作结果。Git 未暂存、提交或推送。


## 已安装：先学会倒立基础课程

2026-09-09：用户长训已结束后，本地 1.1.0 再次替换，新增第二课「先学会倒立」、按接触和连续保持时间验收，原街舞保留为进阶。上节暂缓的 Reward 编辑入口修复一并安装。MPS 200 轮与 CPU 500 轮均已通过 MCP 真实训练并导出，但原生／WASM 稳定倒立仍为 0 秒，尚未学会；具体规则、参数和结果见 [动作测试](duck-actions-2026-09-09.md)。

5,853 Node 测试、8 个 Python 用例及 3 个 MCP 协议用例通过；包内新课／旧街舞试播、失败检查和禁止练习模型入库通过。安装前没有进行中的训练，旧 PID 97162 正常退出，71 个实验室数据文件哈希未变；ZIP CRC、无 ONNX／pyc、签名和包内资源一致性通过。新主程序未自动启动，Git 未暂存、提交或推送。安装证明 `.release-reviews/headstand/installation.json`，包内证明 `packaged-final/report.json`。


## 已安装：街舞后置与学习路线

2026-09-09：移除课程下拉框的街舞入口，只保留平地行走和倒立基础课；学习路线明确为翻转进入倒立并稳定保持 → 恢复正立、站稳收尾 → 最后练街舞。恢复正立尚未开放为独立课程。自定义 Reward、1–2,000 轮参数、已有实验和权重保留；基础练习提交不再携带旧街舞名称，使用本课默认名称。

本次修改 `renderer/lab.html`、`renderer/src/lab-lessons.js`、`renderer/src/lab.css` 和 `renderer/src/lab.js`，同步课程指南、动作诊断、1.1.0 说明及 MCP README／overview／scripts 文档；更新 4 个现有隔离 UI 检查脚本。训练器、奖励公式和验收标准未改，无新增训练任务。

源码与实际 app.asar 的 Reward 编辑／课程草稿隔离／实际 IPC 提交通过；两门现行课接受 2,000、拒绝 2,001 轮。包内课程选项、学习路线、旧倒立候选的 WASM 评测与 8 秒预览后暂停通过，基础模型仍禁止入库；1440 px 截图已目视检查，1000 px 无横向溢出。旧街舞候选在隔离测试中临时注入仅测试入口后可读、可试播，未恢复产品入口。沿用上轮完整回归，本轮只跑相关 UI／IPC／WASM 检查。

已替换 `/Applications/Duck on Desk.app`，版本仍 1.1.0；无进行中训练，71 个现有实验室文件 SHA-256 一致。ZIP CRC、无 ONNX／pyc、安装签名与资源哈希通过。主程序未自动启动，Git 索引为空、HEAD 仍为 41134e1，未提交或推送。证据 `.release-reviews/action-curriculum/` 下的 `packaged/report.json`、`reward-packaged/report.json`、`limit-source/report.json`、`legacy-history/report.json` 和 `installation.json`。


## 已打包、待安装：实验室 Dock／任务栏

2026-09-09：用户反馈机器人实验室不能从系统窗口切换中找到。`electron scripts/smoke-lab-dock.cjs` 在不加载 main／硬件的真实 macOS 窗口中两次复现：实验室可见而 app.dock.isVisible() 为 false。仅切换 activation policy 为 regular 的对照立即变为 true。根因是 LSUIElement／桌宠 showDock=false 在应用级隐藏 Dock，而普通 BrowserWindow 自身无法改变这个状态；实验室此前没有通知共享 Dock 控制器。

`src/shell/robot-lab-window.js` 新增生命周期通知和已有窗口恢复；`src/shell/menu.js` 的共享控制器以“桌宠 showDock 或实验室存在”决定 Dock，包含最小化状态；`src/main.js` 接通两者，并为启动时的早期隐藏保留实验室检查。关闭后读取当前偏好，不保存或回写旧值。Dock 激活可以恢复已有实验室，其他普通窗口已经聚焦时不抢焦点，dispose 移除监听。Windows 显式设置 frame／focusable／minimizable／maximizable=true、skipTaskbar=false 和应用图标；独立普通窗口不传 parent、不套用桌宠的 taskbar helper。

新增 `test/robot-lab-task-switching.test.js` 在真实菜单／实验室模块组合上覆盖 macOS 偏好变化、最小化、关闭、快速重开、激活与清理，及 Windows 正常窗口配置；修复前 5 项失败，修复后全部 6 项通过。相关 45 项和全量 5,859 Node 测试通过，15 个原有跳过。真实窗口回归在源码与 app.asar 通过 Dock 显示、最小化恢复、激活回调、关闭后隐藏／保留用户开启偏好；“关于”真实 UI 的开发者开关及关窗再开同样通过。重复最小化测试需等 Cocoa 恢复动画结束，不用固定动画时长判断产品恢复是否成功。Windows 仅做分支与窗口参数回归，未取得实机任务栏／Alt+Tab 验收。

包为 1.1.0，ZIP CRC、无 ONNX／pyc、包签名通过。用户任务 run_9a52b0f0-09cb-4f06-afcf-8f2467e71aad 正在 MPS 运行 2,000 轮倒立训练，检查时 452 轮，ownerPid=76610 存活；因此本次未退出或替换安装应用，未中断或重启训练。历史 71 文件一致性来自上一节安装，不将本次正常变化的训练日志声称为哈希未变。未启动主进程／实体，未提交、暂存或推送 Git。

证据 `.release-reviews/lab-dock/`：`before/report.json`、`before-repeat/report.json`、`policy-probe/report.json`、`unit-before.log`、`unit-after.log`、`full-tests.log`、`after/report.json`、`packaged/report.json`、`about-packaged/report.json`、`artifact.json` 和 `installation-pending.json`。后续安装必须先确认无活跃训练，再按既有本地替换流程操作并重新采集数据哈希。


### Dock 修复安装完成

2026-09-09：用户确认终止训练后，任务状态复核为 cancelled、603 轮，当前无活跃训练。沿用已通过包内验证的同一 ZIP，现已替换 `/Applications/Duck on Desk.app`，仍为 1.1.0；安装时无主进程需要退出，未自动启动。安装前重新采集并核对 74 个实验室文件哈希，均未变；包资源与签名一致。此次没有改 Reward，也未重新训练。证据 `.release-reviews/lab-dock/installation.json`；上一节 installation-pending.json 仅为当时状态。Windows 实际任务栏／Alt+Tab 仍待实机，Git 未提交或推送。


## 已安装：倒立姿态奖励 v2

2026-09-09：更新默认倒立 Reward，增加全身姿态、重心与实际关节反馈，去掉横躺／无支撑倒置的持续基础分，翻转进展每段有上限、连续保持中断归零。训练页新增真实保持时长、姿态达标占比和可核对的奖励分项，保留自定义奖励；原生与 WASM 使用相同 v2 姿态检查，旧记录仍保留原规则并提示重测。细节见 [动作诊断](duck-actions-2026-09-09.md)。

MCP 实际 MPS 短训 50 轮／51,200 步，111.79 s；分项与总分逐轮误差小于 6.1e−9。原生 3 段与浏览器 1 段倒立保持均为 0 秒，没有学会或加入桌宠。5,859 Node／16 Python／3 MCP 用例通过；源码及包内奖励编辑、完整提交、真实指标、缺失旧指标、草稿切换、WASM 评测和试播暂停通过。额外 5 个固定姿态核对实际 renderer 测量代码的 WASM 数据路径，包括有效头撑与身体接地，和原生结果一致；不是训练成功证据。

无活跃训练、无安装版主进程需退出，已替换 `/Applications/Duck on Desk.app`，版本仍 1.1.0；77 个既有实验室文件 SHA-256 未变。ZIP CRC、无 ONNX／pyc、安装签名与包资源哈希通过。ZIP 为 136,262,197 字节，SHA-256 `a0beb3cbdc48092c2fb846cf3404545f25c21eb685f5c90dd349cc795fa543fb`。保留 1.0.0 回退 ZIP，未自动启动主程序／实体，Git 索引为空、HEAD 41134e1 未变；CUDA 和 Windows 系统切换仍待实机。

证据 `.release-reviews/headstand-posture/`：`installation.json`、`artifact.json`、`short-training.json`、`metric-reconciliation.json`、`wasm-pose-parity.json`、`packaged/report.json`、`reward-packaged/report.json`、`legacy-packaged/report.json`。新建倒立练习使用 v2 模板，旧实验脚本和训练记录没有被覆盖。

## 已安装：第二课先练倒立保持

2026-09-09：当前第二课改为独立 `microduck-headstand-hold`，由环境提供近头撑姿态，先学小扰动保持；旧翻转实验保留原始初态与记录。原生／WASM 与教程明确区分保持能力和自主翻转，练习模型不入动作库。实际 MCP MPS 200 轮完成；最终原生／WASM 最长保持 0.44／0.46 s，均未通过结尾两秒标准，尚无成功参数承诺。

已更新 `/Applications/Duck on Desk.app`，仍为本地 1.1.0；83 个实验室文件未变，旧 PID 77711 正常退出，新主程序未自动启动。5,860 Node／19 Python／3 MCP、包内界面／自定义奖励提交／WASM 检查、ZIP CRC 与签名通过。完整证据和最新 ZIP 哈希见 [保持课交付与实测](headstand-hold-2026-09-09.md)。未连接实体或动 Git。

## 已安装：官方原始网络全量微调

2026-09-09：按用户纠正，两课统一直接加载官方 61→512→256→128→14 / ELU 网络及原始权重，全量更新策略参数，保留原始输入标准化；移除附加修正网络。两次真实 MCP MPS 各 20 轮／20,480 步，四个线性层权重与偏置均更新，导出图与官方同结构。行走通过五秒短程不退步检查；倒立原生／WASM 最长 .04／.02 s，结尾均 0，仍未达标。

本地 1.1.0 已替换，93 个实验室数据文件未变，旧 PID 87623 正常退出，未自动启动新主程序。5,860 Node／22 Python／3 MCP、包内新旧模型评测、ZIP 与签名验证通过。详见[官方全量微调报告](official-finetune-2026-09-09.md)。旧训练记录和残差方案证据保留，未应用候选或动 Git。
