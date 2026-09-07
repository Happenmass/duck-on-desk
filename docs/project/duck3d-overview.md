# Duck on Desk：当前代码总览

核对日期：2026-09-06。以下以本仓库实现为准；部分继承自 Clawd on Desk 的文档仍描述旧精灵主题。

## 功能与分层

| 层 | 主要入口 | 当前职责 |
| --- | --- | --- |
| Coding Agent 接入 | `agents/registry.js`、`hooks/` | Claude Code、Codex CLI、Pi、opencode；hook 安装、进程识别和会话状态采集；Codex official hooks 优先，JSONL 兜底 |
| 本地服务 | `src/state/server.js`、`server-route-state.js`、`server-route-permission.js` | 在 127.0.0.1:24333–24337 接收状态与权限请求 |
| 会话与权限 | `src/state/agent-runtime-main.js`、`state.js`、`permission.js` | 多会话聚合、状态优先级、显示时长、权限气泡；Pi 只同步状态 |
| 桌面外壳 | `src/main.js`、`pet-window-runtime.js`、`pet-interaction-ipc.js` | Electron 透明宠物窗、命中窗、托盘、浮层；左键拖窗、中键抓起和物理落下 |
| 设置 | `src/shell/prefs.js`、`settings-controller.js`、`settings-store.js` | schema v20，统一读写；Agent 接入、外观、音量、移动方式、漫步范围等 |
| 3D 状态桥 | `renderer/src/pet-bridge.js`、`agent-visual-adapter.js` | state-change → duck intent → runtime command，并回报 pet-visual-settled |
| 物理运行时 | `renderer/src/runtime/duck-runtime.js` | Three.js 渲染、MuJoCo 物理、ONNX 策略；动作租约、恢复、形态切换和位移投影 |
| 自由漫步 | `src/robots/duck/roam.js` | 选目标、等待、边界与打断；接收步幅，移动窗口并同步命中区和浮层 |

3D 宠物还支持四种皮肤、分组音量、轮滑、高跷、啄地、叫声、坐站和睡眠。
忙碌状态的原地踏步是既有产品行为；空闲时的屏幕行走由自由漫步负责。

## 行走同步链路

1. 主进程确认可以漫步，选取目标并发送 `roam-heading`，切到 `roam`。
2. 3D 桥应用 `duck-roam`，暂停自主空闲动作，以 system 租约持续驱动行走。
3. 双脚模式按落脚事件累计并平滑分发步幅；轮滑模式累计物理躯干实际平移。
4. `takeDisplacement()` 投影到屏幕坐标；桥每 40 ms 取一次，只在 `duck-roam` 上报。
5. 主进程每 16 ms 消费位移，移动宠物窗。横向位移驱动进度，纵向漂移按计划斜率计算。
6. 到达距离、边界阻挡或被交互/会话打断后结束漫步，切回 idle 并停止 system 行走租约。

这里并非直接把 MuJoCo 世界坐标当作桌面坐标：双脚策略的物理平移较小且不稳定，所以采用落脚步幅；轮滑才使用实际平移。

## 2026-09-06 同步缺陷与修复

### 空闲调度绕过漫步状态

`AutonomyAdapter` 原先有 35% 的 wander 动作，会在 idle 下直接发出 3–5 秒 move 租约。
此时桥会清空而不上报位移，主进程也没有启动漫步，因此出现有步态、无屏幕位移。
真正进入 roam 时又正常移动，形成“有时同步、有时不同步”的表现。

修复：空闲动作只保留 look / peck / quack，将 wander 权重并入 look；所有自主屏幕行走统一由主进程 roam 调度。
不放开 idle 位移上报，因为那会绕过关闭漫步、拖拽、权限气泡和活动范围等门控。
同时将边缘回头交给主进程：朝向侧空间不足而另一侧可走时，选择另一侧并发送 roam-heading，
避免继续依赖已移除的空闲 sweep；传统非步幅驱动主题仍保留跳过本轮的行为。

### 边界阻挡计时被空帧清零

位移每 40 ms 上报一次，窗口循环每 16 ms 执行一次。原逻辑把没有新位移的帧当作“没有阻挡”，
每次清零 blockedMs，持续撞边也无法累计到 600 ms。转向期间实际步幅朝向边界时可触发。

修复：记录首次受阻时间；没有新样本时保留，收到未受阻的实际步幅才清除，按经过时间结束。

回归入口：`node --test test/idle-roam-sync.test.js test/roam-duck-lean.test.js`。

前者运行真实自主动作与状态适配器，覆盖随机动作区间；后者以逐事件虚拟时钟重放 40/16 ms 调度。
两种复现均先失败、修复后通过。它们验证调度逻辑，不替代真实 MuJoCo/原生窗口的视觉验收。

## 2026-09-07 启动/重载后忙碌状态丢失

主进程在 `did-finish-load` 时下发当前状态，但 3D 渲染端要等 MuJoCo 与 ONNX 策略加载完成（模块顶层 `await`，数秒）才注册 IPC 监听，
之前送达的 `state-change` 直接丢失；`pet-visual-ready` 在 macOS 上原本只做 Windows 的窗口恢复，不补发状态。
于是 App 重启或渲染窗口重载时，若会话已处于 working，鸭子只能等 9750 ms 的结算超时重试，重试再丢就一直站着。
修复：`pet-visual-ready` 到达后重新下发当前状态。回归入口：`node --test test/pet-interaction-ipc.test.js`。
