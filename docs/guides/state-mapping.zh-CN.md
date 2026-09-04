# 状态映射

[返回 README](../../README.zh-CN.md)

Duck 的动画由基于物理引擎的 3D 渲染层驱动（`renderer/`，Vite root，主题 id `duck`，`theme.json.renderer = "duck3d"`）。所有 agent 生命周期事件（Claude Code hooks、Codex hooks/JSONL、opencode plugin、Pi extension）都会先归一化为一组固定的逻辑状态；每个逻辑状态在 `themes/duck/theme.json` 的 `states` 表中对应一个 intent id，`DuckRuntime` 再通过 `MotionLeases` 把该 intent 转换成 MuJoCo 运动/行为指令（3D 侧所有运动指令都使用 `source:"system"`，优先级 90——高于自由漫步调度的 10，低于本地用户操作的 100）。

| 逻辑状态 | intent id | 鸭子行为 |
|---|---|---|
| idle / roam / dizzy | `duck-idle` | 恢复 AutonomyAdapter 的静息调度 |
| thinking | `duck-thinking` | 面朝镜头（heading 0，forward 0.6）+ 每 1.5 秒随机 `look` |
| working | `duck-working` | `move {forward:0.7, heading:0}` 持续（2 秒 TTL，循环续租） |
| juggling | `duck-juggling` | `move {forward:0.8, heading:±0.8}`，每 3 秒换向 |
| carrying | `duck-carrying` | `perform peck` 一次 |
| sweeping | `duck-sweeping` | `perform peck` 每 4 秒 |
| attention | `duck-attention` | `move {heading:0}` 持续 1.5 秒 + `perform quack` 一次 |
| notification | `duck-notification` | `move {heading:0}` + `perform quack` 每 2.5 秒 |
| error | `duck-error` | `perform sit` + `look {headPitch:0.5}` |
| yawning / dozing / collapsing / sleeping | `duck-sleeping` | `sleep` |
| waking | `duck-waking` | `wake` |

多个会话同时存活时，Duck 会解析到优先级最高的状态：`error 8 > notification 7 > sweeping 6 > attention 5 > carrying = juggling 4 > working 3 > thinking 2 > idle = roam 1 > sleeping 0`。

## Pi Extension 事件

Pi 使用全局 extension（`~/.pi/agent/extensions/duck-on-desk`），会把交互式会话生命周期事件映射到上面同一组逻辑状态：

| Pi Extension Event | Duck Event | 逻辑状态 |
|---|---|---|
| session_start | SessionStart | idle |
| before_agent_start | UserPromptSubmit | thinking |
| tool_call | PreToolUse | working |
| tool_result (ok) | PostToolUse | working |
| tool_result (isError) | PostToolUseFailure | error |
| agent_end | Stop | attention |
| session_before_compact | PreCompact | sweeping |
| session_compact | PostCompact | attention |
| session_shutdown | SessionEnd | 删除会话；无其他 live 会话时回到 idle |

Pi 在 Duck 中是仅状态（state-only）集成：Duck 不接管权限、不新增确认弹窗，Pi 保持默认 YOLO 执行行为。
