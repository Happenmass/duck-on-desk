# Agent Runtime Architecture

This document holds the deeper runtime and integration notes that were previously in the root `AGENTS.md`.

## Data Flow

```text
Claude Code 状态同步（command hook，非阻塞）：
  Claude Code 触发事件
    → hooks/duck-hook.js（零依赖 Node 脚本，stdin 读 JSON 取 session_id + source_pid）
    → HTTP POST 127.0.0.1:24333/state { state, session_id, event, source_pid, cwd }
    → src/state/server.js HTTP 壳 → src/state/server-route-state.js → src/state/agent-runtime-main.js → src/state/state.js 状态机（多会话追踪 + 优先级 + 最小显示时长 + 睡眠序列）
    → IPC state-change 事件
    → src/shell/renderer.js（<object> SVG 预加载 + 淡入切换 + 眼球追踪）

Codex CLI 状态同步（official hooks primary + JSONL fallback）：
  Codex 触发 SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop
    → hooks/codex-hook.js（stdin JSON，session_id 优先与 transcript_path 的 rollout UUID 对齐）
    → HTTP POST 127.0.0.1:24333/state { state, session_id, event, turn_id, hook_source }
    → 同上状态机（agent_id: codex）

本机 Codex `SessionStart` 首次 POST 发现 Duck 离线时，只有 durable gate 同时满足 `integrationInstalled=true`、`enabled=true`、`autoStartWithCodex=true` 才调用 `auto-start.js` 冷启动桌面应用并重试事件。全新安装的独立开关默认关闭；prefs v17→v18 为已有用户回填 true 以保持升级前行为。remote、WSL 与 WSL interop 路径一律不冷启动。
  Codex 写入 ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    → agents/codex-log-monitor.js（fallback：hook 未覆盖事件、hook 禁用/不可用、历史兼容）
    → src/state/agent-runtime-main.js 对 hook-active session 做事件级 suppression，避免重复状态/重复气泡；本地 JSONL 路径不经过 HTTP server

本机 Codex 注册使用每个 `CODEX_HOME` 下固定的分平台入口。Windows 的固定
`commandWindows` 使用 PowerShell call-operator 直连：
`& "node" "codex-hook.js" --duck-windows-stable`；
hook 进程启动时自读 UTF-8/Base64 `duck-hooks/codex-hook.js.windows.run`
数据 sidecar 注入 env（2026-09-04 起由内联 PowerShell dispatcher 改为直连：
原 dispatcher 的“解码并执行”命令行被 Windows Defender ML 判为
Trojan:Win32/Commando.A!ml，见 duck-on-desk#986）；不落地或二次启动 `.ps1`。
旁路 JSON manifest 供安装器恢复与 Doctor 做完整性、目标健康校验。POSIX 使用
`duck-hooks/codex-hook.js.sh` 与对应 manifest。
Windows 原地升级只要 Node 与安装目录不变就保持同一命令；切换正式包、开发目录、
worktree 或 Node 安装路径会改写直连命令，并需要重新完成一次 `/hooks` review。
sidecar 中仅有 env 变化时不改命令。POSIX 仍只原子更新受管 wrapper，不改
`hooks.json` 的命令字符串。Windows 与 WSL 的 manifest/wrapper 分开保存，
共用 `CODEX_HOME` 时不会互相覆盖目标。Doctor 按 Codex 官方的归一化 handler
SHA-256 精确核对 `trusted_hash`，命令变更后不会因原位置仍有旧 hash 而误报
trusted。

CodeBuddy 状态同步（Claude Code 兼容 hook，command）：
  CodeBuddy 触发事件
    → hooks/codebuddy-hook.js（PascalCase 事件 → agents/codebuddy.js 映射 → HTTP POST）
    → 同上状态机（agent_id: codebuddy）
  Hook 注册到 ~/.codebuddy/settings.json，格式与 Claude Code 完全兼容。

自定义 HTTP Agent（动态注册，state-only）：
  Settings 选择本机可执行文件
    → customApplications 生成稳定 custom-... ID（只代表注册，不证明应用是 AI，也不安装 hook）
    → 应用或外部 adapter 读取 ~/.duck-on-desk/runtime.json 的当前端口
    → HTTP POST 127.0.0.1:<runtime-port>/state { agent_id, session_id, state, event }
    → server-agent-id.js 只接受当前仍注册的 custom ID，enabled gate 决定是否进入状态机
  v1 不支持 /permission；已注册 custom 的权限请求返回 204 no-decision，删除/伪造的 custom- ID 直接拒绝，不能降级成 Claude Code subagent。

WorkBuddy 状态与通知同步（Claude Code 兼容 hook，command）：
  WorkBuddy 触发 SessionStart / SessionEnd / UserPromptSubmit / PreToolUse / PostToolUse / Stop / Notification / PreCompact
    → hooks/workbuddy-hook.js（PascalCase 事件 → agents/workbuddy.js 映射 → HTTP POST）
    → 同上状态机（agent_id: workbuddy）
  Hook 注册到当前 WorkBuddy AI 的 ~/.workbuddy-ai/settings.json（旧版兼容 ~/.workbuddy/settings.json）。集成为 state + Notification only：不注册 PermissionRequest HTTP hook，
  审批始终由 WorkBuddy 原生沙箱与 GUI 处理；无 session_id 的事件在返回合法 stdout 后直接丢弃，不进入 /state。

opencode 状态同步（in-process plugin，~0ms 延迟）：
  opencode 触发事件（session.created / session.status / message.part.updated 等）
    → hooks/opencode-plugin/index.mjs（CLI/TUI 运行于 Bun；Desktop sidecar 运行于 Electron utilityProcess / Node）
    → translateEvent 映射（opencode v2 事件名 → PascalCase Duck event 名）
    → session.created 的 event.properties.info.parentID 会被记录为 child → parent 映射，child 状态上报带 headless: true
    → fire-and-forget HTTP POST 127.0.0.1:24333/state
    → 同上状态机（agent_id: opencode）
  permission.asked 通过 plugin POST /permission 进入 Duck；决定经随机 localhost 端口上的反向 bridge 返回，
  CLI/TUI bridge 使用 Bun.serve，Desktop bridge 使用 node:http，再由 plugin 调用宿主 SDK 的 permission reply route。
  permission.replied 使用 current requestID/sessionID 契约回送 completion lifecycle；同一 request 的 asked/replied
  在 plugin 内因果串行，lifecycle 最多投递 3 次。Duck 只按 agent/request/canonical session/bridge generation
  精确清理 pending UI、timer 与 notification，不向宿主反向发送第二次决定。

Pi 状态同步（global extension，state-only）：
  Pi 触发 session_start / before_agent_start / tool_call / tool_result / agent_end 等事件
    → ~/.pi/agent/extensions/duck-on-desk/index.ts（Pi extension runtime）
    → hooks/pi-extension-core.js 映射为 PascalCase Duck event 名
    → HTTP POST 127.0.0.1:24333/state
    → 同上状态机（agent_id: pi）

opencode 权限气泡（event hook + 反向 bridge，非阻塞）：
  opencode 请求权限 → event hook 收到 permission.asked
    → plugin POST /permission（带 bridge_url + bridge_token）→ Duck 立即 200 ACK（不挂连接）
    → Duck 创建 bubble 窗口 → 用户 Allow/Always/Deny
    → Duck POST plugin 的反向 bridge → bridge 用 ctx.client._client.post() 调 opencode 内置 Hono 路由 /permission/:id/reply
    → opencode 执行对应行为（once/always/reject）
  用户先在 opencode 原生 UI 回答 → event hook 收到 permission.replied（sessionID/requestID/reply）
    → plugin 同步失效 request 的反向 target，并在同 request asked POST 之后发送 replied lifecycle
    → lifecycle 使用 lifecycle_bridge_url/token（不复用普通 bridge 字段，对旧 Duck fail-safe）
    → Duck exact-match 删除该 request 的本地 pending、bubble、timer 与 notification
    → 不调用 reverse bridge，不复制 reply，不产生第二次宿主决定

权限决策流（Claude Code HTTP hook，阻塞）：
  Claude Code PermissionRequest
    → HTTP POST 127.0.0.1:24333/permission { tool_name, tool_input, session_id, permission_suggestions }
    → main.js 创建 bubble 窗口（bubble.html）显示权限卡片
    → 用户点击 Allow / Deny / suggestion → HTTP 响应 { behavior }
    → Claude Code 执行对应行为
    → 子 agent（Task）内触发的请求带 agent_id（实例 uuid）/ agent_type；server-agent-id.js 归一化为
      claude-code 并标记 subagent 来源，`agents["claude-code"].subagentPermissionsEnabled=false`（#451
      子开关）时直接断开连接让 CC 回落终端提示（ExitPlanMode / AskUserQuestion 豁免）

权限决策流（Codex official PermissionRequest command hook，阻塞）：
  Codex PermissionRequest
    → hooks/codex-hook.js POST /permission { tool_name, tool_input, tool_input_description, session_id, turn_id }
    → 默认 intercept 模式：main.js 创建普通 Allow / Deny bubble，用户点击后 codex-hook.js stdout 输出官方 JSON decision
    → 显式 native 模式：server 记录 notification 并立即返回 no-decision，Codex AutoReview / 原生审批继续处理
    → DND / disabled / bubble hidden / Duck unavailable 时 stdout "{}"，Codex 回到原生审批提示
```

## Local Recap Projection

The recap is a local projection of accepted runtime activity, not a second observer at the HTTP or `updateSession()` entry. After agent gates, Codex source/replay arbitration, permission provenance handling, subagent filtering, and completion arbitration settle, `src/state/state.js` maps the accepted boundary through `src/recap-metrics.js` and sends an allowlisted canonical event to `src/recap-runtime.js`.

`src/recap-journal.js` freezes the desktop civil time and replaces any stable scope/session/dedupe identities with installation-local HMACs before appending a 14-day ticket. The same normalized record updates `src/recap-aggregate.js`; `src/recap-coverage.js` independently records when Duck could receive signals. Daily aggregates and coverage remain bounded to 400 local days under `~/.duck-on-desk/recap-v1/`. Query IPC returns only the broad `local` / `wsl` / `remote` scope class and never returns HMAC values, profile IDs, or distribution names. Startup rebuilds the 14-day aggregate in bounded event-loop batches; unsupported pre-release aggregate/coverage schemas are quarantined instead of migrated.

DND remains an interaction/visual gate and does not stop recap or coverage. Suspend, process shutdown, and `recapEnabled=false` close coverage. Historical records retain the time zone, UTC offset, local date, and local hour captured at acceptance; Codex JSONL uses only an accepted line's trusted timestamp. See `docs/guides/recap.md` for the full metric, privacy, and DST contract.

## Runtime Ownership Boundaries

`src/main.js` 是 composition root，不再是各子系统的实现 owner。新增或修改行为时先进入对应 owner，避免把逻辑重新堆回 `main.js`：

| Boundary | Owner |
|---|---|
| HTTP `/state` / `/permission` | `src/state/server-route-state.js` / `src/state/server-route-permission.js`；`src/state/server.js` 负责监听、端口与组合 |
| official hook / local monitor 仲裁 | `src/state/agent-runtime-main.js`，配合 `src/state/codex-turn-fence.js` / `src/state/codex-official-activity.js` |
| 双窗口与浮层 | `src/shell/pet-window-runtime.js` 创建/定位 render + hit window；`src/shell/floating-window-runtime.js` / `src/shell/topmost-runtime.js` 管浮层重排与 z-order |
| Settings 写入与副作用 | `settings-controller` 是唯一写入者；`settings-actions*` 是 pre-commit gates；`settings-effect-router` 是 post-commit runtime effects |
| Settings UI | `settings-ui-core` 持有 shared UI state，`settings-renderer` 是侧栏/tab shell，业务页在 `settings-tab-*` |
| Theme | `theme-loader` 是 stateless loader；`theme-runtime` 是唯一 active-theme owner |

`state.js` 的 session snapshot 是共享 schema：Dashboard、Session HUD（含 Orbit quota ring）以及 LAN PWA 等 consumer 都会读取它。新增、重命名或删除字段时必须检查全部 consumer，不能只看 Dashboard/HUD。

## Windows B1a Process Metadata Capability (#694)

Codex 和 CodeBuddy 的本地 Windows hook 支持一套版本化的 server-side process-chain capability。Duck runtime owner 把以下数据写入 `~/.duck-on-desk/runtime.json`：随机 `instanceGeneration`，以及每个 agent 的 `legacy | shadow | b1a-authoritative` mode。默认始终是 `legacy`；`shadow` 和 `b1a-authoritative` 仅用于显式开发/验证，resolver 初始化或 ABI 校验失败时在写 runtime 前降级回 `legacy`。

本地 Windows、非 remote/WSL 的 hook 可以把当前 hook Node PID 和 runtime generation 放入 `X-Duck-Hook-Pid` / `X-Duck-Process-Instance`；headless/official/subagent 分类在 server 收到请求后完成，只有通过 effective eligibility 的请求才消费这些 header。header 只发往同一次 immutable runtime observation 指定的端口；扫描到其他 fallback server 时自动剥离。PID/generation 是 capability routing metadata，不是认证凭据。B1b adapter 和自定义 HTTP Agent 不进入该协议。

`shadow` 下 hook 仍提供 legacy metadata，server 用新 Windows resolver 做逐请求 fresh walk 并只记录 bounded parity；`b1a-authoritative` 下五个 hook 的 eligible 路径不再启动 legacy snapshot PowerShell，`/state` 和 Codex `/permission` 以 server 结果 replace/clear `sourcePid`、`agentPid`、`pidChain` 与 walk-derived editor。replace 失败必须清 stale process identity、重新计算 `pidReachable`，身份变化时清关联的 Windows Terminal HWND / Orca pane。Codex Desktop 保持 `sourcePid=agentPid`，普通 CLI 保持最外层 terminal 优先。

CodeBuddy direct HTTP `PermissionRequest` 不经过 Duck command hook，因此没有可信 hook PID。B1a 当前只覆盖其 command state；permission-first 仍需真实协议/session identity 证据，不得伪造或从别的 session 猜测 PID。

## Multi-Agent Registry

每个 agent 定义为一个配置模块，导出事件映射、进程名、能力声明（`capabilities` 含 `httpHook` / `permissionApproval` / `sessionEnd` / `subagent`）：

- `agents/claude-code.js` — Claude Code 事件映射 + 能力（hooks、permission、terminal focus）
- `agents/codex.js` — Codex CLI official hook 事件映射 + JSONL fallback 轮询配置
- `agents/codebuddy.js` — CodeBuddy 事件映射（PascalCase，Claude Code 兼容），支持权限
- `agents/workbuddy.js` — WorkBuddy 事件映射（PascalCase，Claude Code 兼容），state + Notification only，无 Duck 权限审批
- `agents/opencode.js` — opencode 事件映射 + 能力（plugin、permission、terminal focus）
- `agents/pi.js` — Pi extension 事件映射 + 能力（extension，state-only，不接管 permission）
- `agents/registry.js` — agent 注册表：按 ID 或进程名查找 agent 配置
- `agents/codex-log-monitor.js` — Codex JSONL fallback 增量轮询器（文件监视 + 增量读取 + 状态 / metadata fallback，不再做审批猜测）

运行时的 agent 安装意图 / 启停 / 权限气泡开关通过 `src/state/agent-gate.js` 读 `prefs.agents[id].integrationInstalled` / `.enabled` / `.permissionsEnabled`。`enabled` 仍然只表示是否处理该 agent 的事件：关闭会让 `state.js` / `server.js` 停止处理事件、清理 session / bubble；`integrationInstalled` 才表示本机 hook/plugin/extension 是否由 Duck 维护。snapshot 缺字段时 gate 保守默认 true 以兼容旧版；新安装的 schema 会显式把 Claude Code / Codex 设为已安装且启用，其余 agent 设为未安装且未启用。Claude Code 额外有 `.subagentPermissionsEnabled` 子开关（#451，仅 claude-code 默认条目携带该 flag），控制 Task 子 agent 发起的 PermissionRequest 是否弹泡泡。

动态 custom Agent 是上述安装模型的明确例外：`customApplications` 是注册真相，validate post-pass 保证每个已注册 ID 都有 gate entry，且始终显式写 `integrationInstalled=false`、`permissionsEnabled=false`。它不会进入 integration sync map；`enabled` 只控制 `/state` ingress。删除注册项会同步清 session、权限残留和该 ID 的 recent-event ring，并删除 stale custom gate；未知的非-custom agent entry 仍保留向前兼容。

`server-hook-events.js` 的 recent-event ring 按已解析 agent ID 分桶，Settings 的“本次运行活动”和 Doctor connection test 共用这份进程内数据。非法 `custom-` identity 一律写入固定 `rejected-custom` 桶，原始 ID 最多保留 80 字符作为诊断字段，不能让随机 ID 制造无界 Map key。ring 不写 prefs，重启即清空。

## Hook And Plugin Sync

启动链路只会自动补齐 `integrationInstalled=true` 且 `enabled=true` 的缺失集成；若 prefs 文件不可读（`locked && recovered`），内存 snapshot 只是非权威 defaults fallback，整条 prefs-backed agent runtime gate 会 fail closed，本次进程不自动同步集成、不启动 monitor、不接受 state/permission ingress，也不恢复旧 session：

- `server.js` 启动后异步同步已安装且已启用的 Claude / Codex / CodeBuddy / WorkBuddy hooks、opencode plugin 和 Pi extension
- Claude hook 同步时还会扫 `DEPRECATED_CORE_HOOKS`（当前含 `WorktreeCreate`）清掉旧版本留下的过时 Duck hook。常规所有权仍认 command 中的字面 `duck-hook.js` marker；兼容 #852 的外部 env 间接形式时，只有“单条简单 Node 调用 + 精确 `DUCK_HOOK_PATH` token + 唯一事件参数”，且 `settings.env.DUCK_HOOK_PATH` 的跨平台 basename 恰为 `duck-hook.js` 才视为 owned。复合命令、间接 env 值和第三方同事件 hook 均 fail closed。deprecated / versioned / HTTP-only / uninstall 路径删除全部 owned 命中；active state hook 则按子项位置折叠成一条，优先保留已 canonical 的命令并保留 mixed wrapper 的 matcher / 第三方 sibling。迁移不会改写 `settings.env`；严格的反注入规则只校验外部 env Node 候选，不会拒绝安装器已解析/保留的绝对路径（如含括号的 Windows 路径）。若 env-only 事件无法验证可用的绝对 Node 路径，会保留一条 env hook 而不是降级成裸 `node`；若已有 literal hook，则保留 literal 而不让不可迁移的 env duplicate 取代它

Settings Agent 页的 Install 会执行对应 sync 并把 `integrationInstalled=true, enabled=true` 一起提交；Uninstall 会调用 marker-scoped 卸载器，并把 `integrationInstalled=false, enabled=false` 一起提交。单独重新启用一个未安装 agent 只打开事件入口，不会写本机配置；手动安装命令主要用于调试、重装或远程机部署。

CodeBuddy 的 PermissionRequest HTTP 所有权只认严格的本机 managed URL，或版本化 marker `duck-on-desk.permission.v1`。旧 `name:"duck"` 只有在 URL 同时属于 managed local endpoint 时才会迁移；同名第三方/custom URL 注册和卸载均不触碰。进程内 startup、Settings install/clear/repair 显式传 `{mode:"local"}` 或 `{mode:"custom",url}`；裸 CLI 与 WSL deploy 用 `{mode:"preserve"}`，防止把 marker-owned custom URL 意外改回 localhost。

### Claude hook 健康巡检与自愈（#657）

`src/state/claude-settings-watcher.js` 除了原有的目录 watcher（盯 `~/.claude/` 目录、debounce 1 秒）外，还跑一个自调度的低频只读健康巡检：

- 默认周期 5 分钟，不依赖任何 settings.json fs 事件——hook 脚本在其他目录（如系统 Temp）被删除也能发现，watcher 和周期巡检共用同一个 `runHealthCheck(reason)` 决策函数。
- 判断逻辑收敛在 `src/state/claude-hook-health.js` 的 `inspectClaudeHookHealth()`：解析 command、校验 nodeBin/scriptPath、比对当前权威路径（`hooks/install.js` 的 `getClaudeHookScriptPath()` / `getClaudeAutoStartScriptPath()` / `CLAUDE_CORE_HOOK_EVENTS`），复用 Doctor 的 `agent-node-bin-parser.js` 解析器，不另起一套正则。
- env-indirected state hook 先复用 `hooks/json-utils.js` 的严格 ownership classifier，再进入健康判定；它不会把未展开的 `${DUCK_NODE_BIN}` / `${DUCK_HOOK_PATH}` 交给普通 target validator。可安全迁移和 owned duplicate 产生专属 automatic repair class；Node 路径无法验证或 ownership 证据不足只产生 degraded 诊断，不消耗 3 次自动修复预算。watcher 的 suspicious-shrink snapshot 也复用同一 classifier，避免把待迁移的 Duck env hook 误记成第三方 hook。
- 可自动修复的问题（`buildClaudeRepairSignature()` 判定）经 `src/state/claude-hook-operations.js` 的实例级队列串行 repair，repair 后重新读盘用同一 inspector 复验，不只信 installer 的 `updated>0`。
- 同一 repair signature 连续 3 次修复+复验失败后进入 `manual-fix-required`，停止自动 mutation，只保留 5 分钟只读复查；健康恢复或 repair class 集合实际变化时清计数。
- `settings.json` suspicious-shrink 期间只弹一次 `notifySuspiciousShrink`，不会每个周期重复通知。
- 当前安装包的 hook 源脚本（`getClaudeHookScriptPath()`）本身不存在时，不会尝试任何 reconcile（写了也没用），状态设为 `source-script-missing`，Doctor 提示重装/重新解压而不是提供配置 Repair。
- 巡检严格受 `manageClaudeHooksAutomatically`、`claude-code.integrationInstalled`、`claude-code.enabled` 三个 gate 保护，和目录 watcher 共用同一套 gate。
- 所有 mutation 入口（启动 reconcile、watcher 自动恢复、周期自愈、Settings Agent Install/Enable、Doctor Fix、`autoStartWithClaude` 开关、Settings Agent Uninstall、legacy hooks Install/Uninstall、About 页 `cleanupIntegrations`）都经过 `src/state/server.js` 持有的同一个 `claude-hook-operations.js` 队列实例，串行执行、互不覆盖；statusline 注册/卸载只在 startup、Settings Agent Install/Enable、Settings Agent Uninstall、About cleanup 这几个来源触发，周期巡检和 Doctor Fix 不碰 statusline。
- 历史 key `claudeQuotaCollectionEnabled` 现在是本机 Claude statusline metadata（context window + 可用 quota）的唯一用户授权。关闭或卸载时，server 先用进程内 suppression 挡住未结尾包，再 ownership-safe 卸载并清除 `profileId="local"`（含 WSL）会话的 statusline 分母所有权，同时从 account-quota store 定向删除所有非 `remote:` 来源的 `claudeQuota` 并立即广播、持久化；同源 Codex provider 的 quota 保留。关闭态启动也会执行同一缓存迁移。statusline 上报拥有 limit，普通 transcript hook 仍可更新 used，并按保留的权威 limit 重算 percent。
- `server.getClaudeHookHealthStatus()` 暴露供 Doctor 使用的只读状态（`healthy` / `repairing` / `degraded` / `manual-fix-required` / `guarded` / `stopped`），与既有的 `getClaudeHookGuardStatus()`（仅覆盖 suspicious-shrink 一种通知）并存，互不替代。

## Permission Bubble

- Claude Code / CodeBuddy 的 PermissionRequest 用 HTTP hook（阻塞式），其他事件用 command hook（非阻塞式）
- `agents/registry.js` 的 capability 声明是 agent 是否进入权限、interactive bubble、subagent 等路径的权威来源；文档里的 agent 名单只是说明，不可替代 capability gate。automation 的 agent/family eligibility 另有显式白名单，故意不能从 `permissionApproval` 自动推导；工具 eligibility 是 mode/adapter-specific，不是单一逐工具 allowlist
- 动态 custom HTTP Agent v1 是 state-only：`/permission` 恒不返回 Allow/Deny，也不创建权限 bubble
- WorkBuddy 不进入 `/permission`：权限请求只以 Notification 驱动提醒，Allow / Deny 决策留在 WorkBuddy 原生 GUI
- Codex 的 PermissionRequest 是 official command hook；hook 脚本挂起等待 `/permission`，再把 sanitized allow/deny JSON 写到 stdout
- `POST /permission` 接收 `{ tool_name, tool_input, session_id, permission_suggestions }`；Codex 额外带 `turn_id`、`tool_input_description`、`tool_input_fingerprint`
- 每个权限请求都会创建独立 `BrowserWindow`。普通卡片默认保持约 340 CSS px 的三行摘要；长内容和次级操作通过用户点击进入约 500 CSS px 的详情态，详情正文独立滚动，标题与决定按钮固定可见。安全 normal layout 中到达的首张可回答 Ask 默认直接进入详情态；桌面同时最多一个详情 owner，其他请求仍是摘要卡。切换详情不会销毁窗口，因此 Ask/Plan 的选择、输入草稿、步骤和滚动位置都保留
- 普通工具摘要态保留 Allow/Deny、permission suggestions（含 Always）和可用的会话授权；Plan 摘要态同时提供「查看计划」与快速批准，反馈/回终端等次级操作只在详情态出现；未能创建期默认展开的 Ask 摘要态只提供「回答」。Plan 与默认展开的 Ask 到达时都不抢焦点；只有本地显式展开或 queue selection 才聚焦窗口并发送一次 restore-active-control。Win/Linux 由创建期 `focusable` 覆盖其潜在输入需求
- bubble 通过 IPC `bubble-height` 回报 `{state, measurementEpoch, height}`。主进程只接受当前摘要/详情 epoch 的测量，避免展开→收起→展开期间的旧高度覆盖新布局；详情高度以 `min(60% workArea, 620 CSS px)` 为偏好，并以实测 chrome + 5 行正文为可读下限、当前 workArea 为硬上限。卡片没有自己的宽度（`html/body` 撑满窗口），自然高度随 BrowserWindow 宽度变化，所以 renderer 在窗口宽度真正改变后会再报一次高度；详情→摘要的 presentation 早于 `repositionBubbles()` 收窄窗口，没有这次补测就会按详情宽度少算一个折行，摘要卡底部被窗口裁掉
- `permission.js` 是 permission presentation 的唯一 owner：它用目标 workArea、text scale、HUD avoid rect 和每张卡实测宽高先尝试原逐窗栈；不安全时按 agent + session 选 FIFO 代表并预留队列入口，再只向减少非保护代表的方向收敛。详情、IME composition、文本输入和用户显式选中的请求是保护项。可选代表准入按 expanded owner 的 frozen size 计算，不能靠压扁保护项腾位置；代表集合确定后，带 launcher 的最终 layout 才从 expanded viewport 的本轮有效高度中扣除 launcher、已选其他代表和全部 gaps。该 effective cap 不改 frozen normal-mode budget；含 expanded representative 且最终仍不安全的候选不得进入新的 queue revision/ACK。首次从 normal mode 命中该 guard 时仍应用 crowded normal bounds 并同步全可见 ownership，已有 committed overflow 则保持原样；普通非展开请求继续沿用既有 queue-failure fallback。Follow 模式详情朝远离桌宠的一侧扩展，Fixed 模式保持所选角的边缘对齐
- overflow 队列使用独立 `permission-queue.html` / preload / renderer，只暴露 open、close、select、ACK 四类导航 IPC，没有任何决定 IPC，也不接收本地详情、wire input、suggestions 或 token。抽屉打开时隐藏请求窗口但不销毁；选中项后恢复原 BrowserWindow/DOM。每个队列 revision 必须先 ACK 再提交 visible/hidden 集合，提交期限从第一条尚未被当前 ACK 表示的请求开始且不会被后续 revision 续期；队列加载、renderer、window 或 ACK 失败时，本 overflow episode 只回退逐窗栈且不重建、不决定请求
- 全局 Allow/Deny 快捷键对已有窗口的请求，只作用于 presentation owner 选定、可见且可操作、完整处于 workArea 内并避开 HUD 的原目标卡片；ACK 前、队列失败回退与保留 crowded normal bounds 的保护项回退也必须满足这一条件。normal 模式没有窗口的请求保留既有 fallback。目标不安全时停用快捷键，不能跳过它去决定另一张卡片。petHidden 使用 request ordinal cutoff 隔离旧请求与隐藏期间的新请求；topmost、IME overlap、HUD/update/Orbit 避让和 roam hold 都只扫描 presentation owner 返回的真实可见 permission windows（含队列及仍在 fade 的请求窗）
- 本地详情数据与网络/决策数据分离：route 在生成有界摘要的同时保留最多 128 KiB 的仅本地显示详情；fingerprint、automation 与 HTTP 回包继续使用原有数据。Ask 的 wire question/answer key 保持上游原文，长正文和选项说明只影响详情显示
- 支持 Allow / Deny / suggestion 决策，以及 `addRules` / `setMode` suggestion 类型
- `permission-automation-policy.js` 的 off / auto-tools / unattended 与 `session-automation-coordinator.js` 的 per-session grant 会在 bubble 渲染前产生真实决定。auto-tools 对 Claude 的未知 built-in（除有效 namespaced MCP）fail closed，但其他已知 adapter 对非空工具名不都使用逐工具 allowlist；unattended 在识别已知 decision tools 后仍有意对可作 Allow/Deny 的未知请求保留“handle every request”行为。新增 agent/tool/interaction 必须同时审查 policy 与 tests，不能笼统假设 unknown 一律 defer
- 本地 bubble 是唯一的人工决策通道；关闭它（全局或 per-agent）不得转成 deny，而是直接断连产生 no-decision，让 agent 回原生 UI 重问
- DND 只负责“不弹 bubble”，不替用户决定权限：opencode 分支 silent drop，让 TUI 内置权限提示接管；Claude Code 分支 `res.destroy()`，让 CC 回到内置聊天/终端确认；Codex 分支返回 no-decision `{}`
- Codex 审批只认 official `PermissionRequest` hook；JSONL fallback 不再根据 shell function_call 猜测审批，也不再创建 Codex passive approval notify bubble
- 涉及 Claude Code 权限 payload 的改动（`permission_suggestions`、`updatedPermissions`、elicitation 输入等）必须至少用一次真实 Claude Code 验证；`curl` 自编请求历史上掩盖过字段结构 bug

### Codex official hook notes

P0 spike（2026-04-26，Windows native Codex CLI）采到的实际 payload 边界：

- `session_id` 与 `transcript_path` 文件名里的 rollout UUID 一致；`codex-hook.js` 仍优先从 `transcript_path` 提取 UUID 作为防御。
- `permission_mode` 在采样到的 SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / Stop 中都存在，值为 `default`。
- `SessionStart.source` 采到 `startup`；其他事件不带 `source`。
- `Stop.stop_hook_active` 采到 `false`；`true` 时 hook 直接 no-op，避免 Codex stop continuation 边界抖动。
- 普通 `PreToolUse` / `PostToolUse` 的 `tool_input` 不保证有 `description`；Bash 和 `apply_patch` 样本只有 `command`。
- `PermissionRequest.tool_input.description` 在真实审批样本中存在，作为 bubble 文案首选；缺失时回退格式化 `tool_input`。
- Codex PermissionRequest 输出必须 omit `updatedInput` / `updatedPermissions` / `interrupt`，不能写 `null`；这些字段今天 fail closed。

## Plugin Notes

opencode 是 plugin 形式集成的 agent；其他 agent 主要是 hook 脚本。

- 进程树 walk 从 `process.pid` 起步，不是 `ppid`
- `task` 工具会直接新建 session，而不是产出 subtask part；只有 `session.created` 明确带 `event.properties.info.parentID` 的 session 才会被视为 child
- opencode child session 作为 root 拥有的后台 headless 工作处理：不参与 HUD / focus / 多会话 fanout，`session.idle` 会降级为 `sleeping/SessionEnd`，root session 的 `session.idle` 才映射 `attention/Stop`
- 由于 `permission.ask` hook 在 opencode 1.3.13 上未被调用，权限只能走 event hook + 反向 bridge
- plugin 内发出的 POST 必须 fire-and-forget，避免拖慢 TUI
- 打包后需要把 `app.asar/` 重写为 `app.asar.unpacked/`

## Pi Notes

- Pi 使用 global extension 目录 `~/.pi/agent/extensions/duck-on-desk`；安装器复制 `pi-extension.ts` 和自包含的 `pi-extension-core.js`
- Extension 运行目录不在 Duck repo 内，不能依赖 `hooks/shared-process.js`；需要的进程树和 HTTP 逻辑保持在 extension 文件内
- 只在 `ctx.hasUI === true` 或交互式 TTY 模式上报状态，避免 print/RPC 模式污染桌宠状态
- Pi 是 state-only：`tool_call` 只上报 `PreToolUse` 状态，不等待 Duck `/permission`，不弹权限气泡，也不调用 `ctx.ui.confirm()`
- 旧版 managed extension 如果仍在已启动的 Pi 进程里向 `/permission` 发请求，server 返回 allow，保持 Pi 默认 YOLO 行为，而不是把 fallback 变成手动确认
- `tool_call` handler 必须顶层 catch 并返回 `undefined`；Pi 的 `emitToolCall()` 不 catch extension 异常，未捕获异常可能变成通用 `Extension failed, blocking execution`
- `tool_result` 按 `isError` 拆成 `PostToolUse` / `PostToolUseFailure`
- Pi permission subgate 默认关闭：`prefs` 默认把 `agents.pi.permissionsEnabled` 置为 `false`；v4 migration 会把旧 true 重置为 false

## Terminal Focus And Remote

- CJS hook 脚本通过 `hooks/shared-process.js` 的 `createPidResolver()` 与 lifecycle context 遍历进程树定位终端应用 PID（Windows Terminal、VS Code、iTerm2 等）；opencode-family plugin 保留自己的内部 resolver
- 不要用 `process.ppid` 做轻量替代：Claude Code / hook 进程链里它通常只是临时 shell PID，不稳定也不可持久化
- `source_pid` 跟随状态更新送到 `main.js`，用于 Sessions 菜单聚焦
- 右键 Sessions 子菜单点击后，`focusTerminalWindow()` 会用 PowerShell（Windows）或 `osascript`（macOS）聚焦终端

## Context Menu Owner Window

- `contextMenuOwner` 必须保留 `parent: win`；没有 parent 再配 `closable: false` 会导致 `app.quit()` 无法正常收尾
- 退出路径依赖 `requestAppQuit()` 先把 `isQuitting = true`，再让 `window-all-closed` 真正走到退出分支；不要绕开这套守卫

## Updating

- Git 模式（非打包，主要是 macOS/Linux 源码运行）会 `git fetch` 比较 HEAD，有更新则 `git pull` + 必要时 `npm install`，然后 `app.relaunch()`
- Windows NSIS 与 macOS DMG 打包模式走 `electron-updater`；均保持 `autoDownload=false`，用户确认后才下载
- macOS Release 同时发布 x64 / arm64 的 DMG 与 ZIP；DMG 用于首次/手动安装，Squirrel.Mac 只消费 ZIP。`latest-mac.yml` 必须同时列出两架构的 ZIP 与 DMG，且 top-level `path` 指向 x64 ZIP
- macOS 下载完成后可选择立即重启，或稍后正常退出并重新打开；安装请求期间复用 update bubble 显示准备状态，ready/staging 错误必须作为真实错误显示，不能降级成“已是最新”
- 旧版 DMG 没有 ZIP 更新载荷，不能自举到首个支持应用内更新的桥接版；现有用户仍需手动安装桥接版一次。单元/metadata/包结构验证不等于同一 Developer ID 的 A→B 真机升级证据
- 托盘菜单里的 “Check for Updates” 可以手动触发

## i18n

- 支持 en / zh / zh-TW / ko / ja / pt-BR / es
- 文案集中在 `src/shell/i18n.js`
- 语言偏好持久化到 `duck-prefs.json`，启动时通过 `hydrate()` 灌入 controller
