# 已知限制

[返回 README](../../README.zh-CN.md)

| 限制 | 说明 |
|------|------|
| **Codex CLI：终端跳转是 best-effort** | `request_user_input` 卡片会在 official hook / session metadata 能定位本地窗口时跳回 Codex。仅靠 JSONL 可能拿不到可用终端 PID，此时卡片只作为只读提醒。 |
| **Codex CLI：hook 覆盖仍不完整** | Official hooks 已覆盖实时状态和 `PermissionRequest` 观察 / intercept 模式，但不是所有运行时信号都有 hook。Duck 会保留 JSONL 轮询，用于 hook 被禁用的会话，以及 web search、context compaction、turn aborted 等 fallback-only 状态 / metadata 事件；这些事件仍可能有轮询延迟。审批不再从 JSONL 猜测，必须依赖 official `PermissionRequest` hook。 |
| **Codex CLI：用户提问卡片只读** | Codex official hook 事件集目前不包含 `request_user_input`。Duck 从 JSONL transcript 观察它，因此提醒可能有一个轮询周期的延迟。选项和自由输入仍在 Codex 原生界面完成；Duck 不注入按键，也不会把这些问题变成可操作审批。 |
| **自定义 HTTP Agent：仅状态，且需要发送端** | 注册可执行文件只会分配 ID 并公开 `/state` 合约，不会安装 hook、观察进程，也不能证明该应用是 AI 工具。应用或 adapter 必须读取 `~/.duck-on-desk/runtime.json` 的当前端口并主动上报。custom v1 不支持 `/permission`，审批仍在应用自己的界面完成。 |
| **opencode：child session 仅作为后台工作** | 当 opencode 的 `session.created` 明确带 `event.properties.info.parentID` 时，Duck 会把该 child / subtask 视为 root session 拥有的 headless 后台工作。它不会出现在 HUD / focus 表面，也不会参与多会话 fanout 动画。 |
| **opencode：终端聚焦锚定启动窗口** | Plugin 跑在 opencode 进程内，`source_pid` 指向启动 opencode 的那个终端。如果你用 `opencode attach` 从另一个窗口接入，点击桌宠只会聚焦到最初的启动窗口。 |
| **Pi：仅状态同步** | Duck 通过全局 extension 观察 Pi 交互式会话生命周期和工具事件，但不接管权限、不新增确认弹窗。Pi 会保留默认 YOLO 执行行为。 |
| **Pi：session reload 可能短暂闪烁** | Pi 在 reload / session replacement 时会先发 `session_shutdown`，随后新 runtime 发 `session_start`。Duck 可能短暂删除并重新创建 Pi 会话。 |
| **Windows Terminal：tab 聚焦能力有限** | Windows Terminal 会用一个宿主窗口 / 进程承载多个 tab，Duck 无法可靠激活其中某一个指定 tab。HUD / Dashboard 终端跳转最适合单独的传统 `cmd.exe` / PowerShell 窗口，或标题里包含项目目录名的独立 Windows Terminal 窗口。Windows 11 上，`cmd.exe` 和 PowerShell 也可能默认被 Windows Terminal 托管；如果要使用传统窗口，需要把默认终端应用程序改为 Windows 控制台主机。 |
| **Windows：hook 的进程信息需要 Duck 正在运行** | 终端聚焦和会话 PID 来自一次进程树查询，hook 只在 Duck 真正运行时才做。从 **v0.13.0** 起，退出 Duck 后残留的 CLI hook 不再查询进程树——它只上报已有信息就结束。可见影响是：在 Duck 关闭期间开始的会话，要等到 Duck 运行后的下一个事件才有可点击聚焦的目标；Duck 已经认识的会话会保留此前学到的 PID。强杀 Duck 后的几秒内、以及 `~/.duck-on-desk/runtime.json` 不可读时（Doctor → Local server 会给出警告）同理。升级到 v0.13.0 后首次重启 Duck 之前，旧版 `runtime.json` 没有 owner 字段，hook 会按"Duck 未运行"处理并省略这些信息——重启一次即可恢复。 |
| **Windows：Duck 在线时部分 agent 仍会跑一次 PowerShell 进程查询** | 上面那次查询目前仍是一个隐藏的 PowerShell，会读取进程列表，安全软件可能因此告警。**v0.13.0** 已经做到：Duck 未运行时不再执行它，且临时缓存不再保存 agent 的命令行（只保存 `headless` 是/否）。在线路径暂时未变，跟踪于 [#681](https://github.com/rullerzhou-afk/duck-on-desk/issues/681)、[#627](https://github.com/rullerzhou-afk/duck-on-desk/issues/627) 和 [#634](https://github.com/rullerzhou-afk/duck-on-desk/issues/634)。 |
| **macOS 安装包自动更新需要一次桥接安装** | 旧版 macOS 应用没有 ZIP 更新载荷，无法把自己自动升级到首个支持应用内更新的版本；现有用户需要先手动安装一次首个已签名桥接版 DMG。装上桥接版后，后续签名并公证的版本可在 Duck 内下载，选择“立即重启”完成安装，或选择“稍后”并在退出、重新打开后完成。单元测试和包检查不能替代真实签名 A→B 真机升级；尚未覆盖的平台必须在发版证据中标为 pending。 |
| **Linux 安装包不支持自动更新** | AppImage/deb 仍需从 GitHub Releases 手动下载；使用 `git clone` + `npm start` 的源码版本可走应用内 `git pull` 更新。 |
| **Linux/Wayland：拖动和鼠标跟踪受限** | 原生 Wayland 禁止客户端定位窗口和查询全局光标，因此桌宠会居中出现、无法拖动，也无法跟踪鼠标。若 Wayland 会话中存在可用的 X server，Duck 会在 XWayland 下自动重启一次（`--ozone-platform=x11`），以恢复窗口定位和拖动；此时鼠标跟踪仍仅限桌宠自身窗口。普通应用无法在 Wayland 下实现全屏光标跟踪；如需此能力，请使用原生 X11（Xorg）登录会话。`DUCK_OZONE_PLATFORM` 可控制自动重启：`x11` 强制使用 XWayland，`wayland` / `auto` 保持原生 Wayland；命令行显式传入的 `--ozone-platform=…` 始终优先。详见 [#441](https://github.com/rullerzhou-afk/duck-on-desk/issues/441)。 |
| **Electron 主进程无自动化测试** | 单元测试覆盖了 agent 配置和日志轮询，但状态机、窗口管理、托盘等 Electron 逻辑暂无自动化测试。 |
| **Claude Code：桌宠未运行时工具被自动拒绝** | 桌宠 HTTP 服务未运行时，Duck 注册的 `PermissionRequest` hook 因 `ECONNREFUSED` 失败，Claude Code 当前会把这种失败当作"用户拒绝"，影响 `Edit`、`Write`、`Bash` 等所有需要权限的工具。这违反 CC 自己的 hooks 文档（声明 HTTP hook 失败应 non-blocking） —— 见 [anthropics/claude-code#46193](https://github.com/anthropics/claude-code/issues/46193)。绕过：保持桌宠运行（推荐），或临时把 `~/.claude/settings.json` 里的 `PermissionRequest` key 重命名以禁用该 hook。 |
| **Claude Code + CC Switch：受保护的自动修复暂停** | Duck 通常会在其他工具重写 `~/.claude/settings.json` 后自动补回 Claude hooks。但如果文件突然缩水到看起来不安全，Duck 会暂停自动修复，避免把外部工具的半成品配置固化；Doctor 会把 Claude Code 标为需要 Fix。可通过 **Settings -> Doctor -> Fix**、重启 Duck，或重新打开「自动管理 Claude hooks」修复。CC Switch 的 Shared Config Snippet 可在同一台机器上携带 Duck hooks，但这些 hooks 含本机路径和端口，不建议当作跨设备通用片段同步。 |
