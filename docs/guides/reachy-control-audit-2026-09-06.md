# Reachy Mini 控制核对与异味事件记录（2026-09-06）

## 当前边界

用户报告 Idle 卡顿及烧糊味，随后明确确认实体已断电。已停止 Duck on Desk 进程（PID 14866）。本次仅离线阅读、模拟测试和构建，未连接设备、未发送动作、未安装或重启应用。不得把软件修正视为硬件可安全上电的证明；异味需由厂商/维修检查电机、驱动、电源及线束等实际部位。

## 双向证据

- 本机 `/Users/guhappen/自媒体运营/reachy-embodied-agent/uv.lock` 固定 Python reachy-mini 1.9.0；与此前实体 /api/daemon/status 返回版本一致。
- 该项目 `adapters/reachy_sdk.py` 使用官方 WSClient、单条 SetFullTargetCmd、基于 monotonic 时间的轨迹，应用层默认 60 Hz。这是本机应用选择，不是所有官方组件统一频率。
- 官方 SDK 仓库本地 `/tmp/duck-reachy-mini-upstream`，核对 tag v1.9.0：`reachy_mini.py`、`daemon/backend/abstract.py`、`io/ws_server.py`、`io/protocol.py`、daemon move/motors/volume 路由。
- SDK 客户端 goto_target 委托后台任务；daemon play_move 默认 100 Hz；此前硬件状态报告约 50 Hz 控制循环。应用目标、daemon 插值、反馈和物理总线频率必须区分。
- daemon wake_up 按距离确定抬头时间，播放 wake_up.wav，然后 20° roll（0.2 秒）和回正（0.2 秒）。此前桌宠固定 3 秒 goto 省略了这部分，确实不一致。
- daemon goto_sleep 先按需回正，再收头并等待，最后 MotorControlMode.Disabled。Python 顶层 goto_sleep 与 daemon 版本的断电细节不同；桌面应用应调用实际 daemon 的完整生命周期接口。

## 确认的软件问题

1. RAF 上 `now-lastSent >= 40ms` 不是稳定 25 Hz。10 秒确定性推演：30/60/120 FPS 分别约 14.9/20/23.9 Hz，且 stall 后 dt 截断进一步改变轨迹速度。
2. 每次发送 set_target/set_antennas/set_body_yaw 三条指令，不保证同一物理周期原子更新；与本机 Python 适配的 SetFullTargetCmd 不同。
3. 对反馈逐步追赶及后续分轴夹紧会改变原轨迹；分轴夹紧不是机械可达性、碰撞或负载验证。之前用理想假反馈测试不足以验证实机控制质量。
4. 之前扩大的位置/旋转校验只能证明数值在范围内，不能证明 Stewart 平台负载安全。
5. 自定义休眠不关闭电机，缺失官方 daemon 的完整收尾。

以上足以解释软件与官方动作不一致，但**不能据此确认烧糊味的物理成因**。此前“克服死区”的观察也不能排除其它机械/控制因素。

## 离线整改

- 移除 renderer -> physical pose 写入通路，sendPose 一律拒绝；实体 Idle 保持官方待机，不注入自编连续动作。
- wake/sleep 直接使用 /api/move/play/wake_up、/api/move/play/goto_sleep；串行执行、检查完成及电机状态，禁止不确定响应后重发。
- connected renderer 仅跟随反馈；生命周期声音由 daemon 拥有，不重复播放本地音效。
- set_volume 走官方 SDK 静默命令，用 HTTP current 验证（SDK 1.9.0 socket 命令不回 ACK）；共享静音和音量，不走带试音的 REST set。
- 尚未恢复实体 Idle 表情；若以后恢复，需独立控制时钟、完整目标原子指令、动作仲裁和硬件验收，不通过调高 RAF 频率修补。

## 后续验收边界

先检查异味设备；在硬件适合复测且用户明确同意前，不启动旧版/整改版，不重连、不做电机测试。模拟测试只能证明路由、序列和错误处理，不能证明温升、电流、卡滞或寿命安全。

## 分层复核（2026-09-06，用户明确策略）

整改前源码只实现了姿态单向镜像：`reachy-runtime.applyVisual` 仍把动画文件名经 `reportReachyState` 送回 main，main 据此调用物理生命周期；提示音也由渲染状态发起，`snapshot.sleeping` 使用动画名而非实体状态。

现已改为：`state.js` 在语义状态提交点直接通知主进程 Reachy 策略；该策略串行调用官方 daemon 生命周期并选择实体/电脑提示音。renderer 只接收状态做离线虚拟动画，或接收实体反馈做 3D 投射，不再拥有 `reachy-state` / `reachy-sound` 反向控制 IPC。实体快照中的 `sleeping` 仅来自本进程完成的官方休眠及电机反馈；离线虚拟快照才读取虚拟状态。

连接、主机切换与断线各自推进代际，旧动作和旧提示音不能落到新连接；不确定 ACK 的动作不会被其清理状态自动重试。初次连接只同步当前休眠目标，不重放历史通知/错误，也不因普通清醒状态自动启用外部关闭的电机。官方唤醒动作需要执行或正在执行时会丢弃同时到达的瞬时提示音，避免与 daemon 的动作声音重叠或稍后重放过期提示。此轮仅运行离线测试与 renderer 构建，未启动应用或连接实体。
