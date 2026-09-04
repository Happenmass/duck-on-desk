# 配置指南

[返回 README](../../README.zh-CN.md)

## Agent 配置说明

全新安装默认只安装并启用 Claude Code 和 Codex。其他本机 agent 需要先到 **Settings → Agents** 点该 agent 的 **Install / 安装**；安装且启用后，Duck 才会在启动时继续同步对应 hook / plugin / extension。单独关闭 agent 只会停止事件入口，不会卸载文件；**Uninstall / 卸载** 只删除 Duck 管理的 hook / plugin / extension 条目，并同时禁用该 agent。

**自定义 HTTP Agent** — Settings 可以注册其他本机可执行文件并分配稳定的 `custom-...` ID，但“注册”不会自动安装 hook，也不会让普通应用自动上报事件。自定义 Agent v1 仅支持状态：应用或你编写的 adapter 必须主动向 Duck 运行时的 `/state` 地址 POST 生命周期事件；权限决定仍留在应用自己的界面中。动态端口发现、请求体、三平台示例以及禁用/移除语义见 [custom-agent-http.md](custom-agent-http.md)。

**Claude Code** — 开箱即用。Duck 启动时会自动注册 hooks。只有在确认 Claude Code 版本兼容时才会注册 versioned hooks（`PreCompact`、`PostCompact`、`StopFailure`）；如果版本无法确认，会自动回退到核心 hooks，并清理旧的不兼容条目。除了监听 `~/.claude/settings.json` 所在目录的变化外，Duck 还会每 5 分钟做一次只读健康巡检——即使 hook 脚本是在系统 Temp 等其他目录被清理、且 `settings.json` 本身完全没变化，也能发现并自动修复。同一问题连续自动修复 3 次仍失败会停止自动重试，Doctor 会提示手动 Fix；如果是当前安装包自身的 hook 脚本缺失（例如安装损坏），Duck 不会盲目重写配置，会提示重新安装或重新解压。

### Claude Code 使用信息：官方状态栏，不抓取网页

本机 Claude 使用信息采集**默认关闭**。可在 **Settings → General → 额度环 → 采集本机 Claude 使用信息** 中显式开启；开启后，Duck 会把自己的可见 `statusLine.command` 添加到 `~/.claude/settings.json`。

这里使用的是 Claude Code 官方扩展机制，不是私有或逆向接口。Claude Code 的[官方 statusline 文档](https://code.claude.com/docs/en/statusline)会向状态栏命令提供 `context_window.current_usage`、`context_window.context_window_size`，以及可用时的 `rate_limits`；命令在本机执行，不消耗额外 API token。

数据路径如下：

1. 一次正常 Claude Code 交互后，Claude Code 自己把官方 statusline JSON 通过 stdin 交给已配置命令。
2. Duck 读取输入 token 用量与上报的上下文窗口大小，并在 Claude Code 提供时读取订阅额度；终端中仍会显示一条简短、可见的状态栏。
3. Duck 只把规范化后的上下文快照和可用额度发送到自身的 `127.0.0.1:24333-24337` loopback 服务。

此功能**不会**额外请求 Anthropic、抓取 `claude.ai`、调用 `/usage`，也不会读取 Claude 的认证 cookie/token。转发内容只有规范化的 token 数、窗口大小，以及可用额度的百分比/重置时间，不包含 prompt 或 transcript 正文。即使 context window 可用，`rate_limits` 仍可能缺失。

#### 模型范围的 Claude 额度（例如 Fable）

除通用的 5 小时和每周额度外，Claude 还可能设置模型范围的独立周额度。例如，Anthropic 说明符合条件的 Max 与 premium seat 订阅可在账号每周额度的一定比例内使用 Fable，并可在 Claude 自己的 Usage 设置中同时查看总体与 Fable 用量。它在产品语义上类似一个单独识别的模型额度，但目前并不通过 Duck 现用的同一集成面提供。

截至 2026 年 8 月 15 日，Claude Code 官方 statusline 合约只公开 `rate_limits.five_hour` 与 `rate_limits.seven_day`。本次调查观察到 Claude Code 的内部本地缓存会在 `cachedUsageUtilization.utilization.limits` 下以 `weekly_scoped` 条目表示 Fable，官方客户端自身也会通过内部 `/api/oauth/usage` 请求取得更完整的用量数据；但该缓存 schema 与接口都没有被文档化为稳定的第三方集成合约。

因此 Duck 有意**不**读取 Claude Code 的内部用量缓存、不读取或刷新 Claude OAuth 凭据，也不调用未公开的 usage endpoint。结果是：Fable / 模型范围额度可能出现在 Claude 自己的 Usage 设置中，却不出现在 Duck。这是上游可见性边界，不是 Duck 漏解析了官方 `rate_limits` 对象；在没有受支持的数据源提供额外 bucket 时，单独增加一个展示 provider 也无法解决。

技术上可行不等同于平台支持。只有当 Anthropic 通过官方 statusline payload 暴露模型范围额度、公开只读的第三方 usage 接口，或以其他方式明确支持该集成时，Duck 才会重新评估接入。在此之前，Duck 不显示 Fable 额度属于预期行为。参见 Anthropic 的 [Fable 套餐说明](https://support.claude.com/en/articles/15424964-claude-fable-5-on-your-plan)与 Claude Code [官方 statusline schema](https://code.claude.com/docs/en/statusline)。

Claude Code 只有一个用户级 statusline 槽位，因此 Duck 绝不会静默覆盖已有的自定义状态栏：槽位被占用时，启用操作会显式失败并保持原命令不变；关闭采集只移除带 Duck ownership marker 的命令，并立即清除缓存的本机 Claude 额度，同时保留所有非 Claude provider。

没有 Duck statusline 时，普通 Claude hooks 仍会从 transcript 上报输入 token 用量。Duck 只对封闭列表里的标准 Claude ID 使用兼容性分母；模型为空、自定义或未知时只显示 used，不再猜成 200K。要让自定义 provider 的真实上限与 Claude Code `/context` 一致，需要开启此开关，让 Claude Code 自己上报的 `context_window_size` 持有分母，同时 transcript hooks 继续刷新 used。

普通本机修复命令 `npm run install:claude-hooks` 不会开启采集。显式调试命令 `npm run install:claude-hooks -- --statusline` 可以安装并显示 Duck 状态栏，但 Settings 开关关闭时，应用仍会把其本机 context/quota POST 当作成功 no-op；下次本机启动 reconcile 也会移除这个 Duck 管理的调试槽位。

**Codex CLI** — 开箱即用。Duck 会在检测到 Codex 时自动注册 official hooks 到 `~/.codex/hooks.json`，并在用户没有显式关闭 hooks 时启用 `[features].hooks = true`。Installer 会把已废弃的 `[features].codex_hooks` 迁移到 `hooks`，同时保留用户显式设置的 false。Official hooks 提供实时状态和真实 Allow/Deny 权限气泡。**Settings → Agents → Codex → 随 Codex 启动** 单独控制本机 Codex 的 `SessionStart` 能否在 Duck 未运行时拉起桌宠；关闭它不会停用状态或审批接入，Duck 已运行时仍然正常工作。全新安装默认关闭，升级用户则保留此前的开启行为；WSL hook 永远不会冷启动桌面应用。`~/.codex/sessions/` JSONL 轮询只保留为状态 / metadata fallback，用于 hook 被禁用或 hook 未覆盖事件；审批不再从 JSONL 猜测。Codex 发出 `request_user_input` 时，Duck 会从 transcript 中识别该调用，播放通知反应并显示问题/选项的只读预览。回答仍在 Codex 原生界面中完成，卡片不会注入选择；匹配的工具输出写入后会自动关闭。

**CodeBuddy** — 使用与 Claude Code 兼容的 hooks，配置写入 `~/.codebuddy/settings.json`。需要本机 CodeBuddy 追踪时，先到 **Settings → Agents** 安装；安装且启用后，Duck 才会在启动时继续同步 hooks。PermissionRequest 条目使用版本化 marker `duck-on-desk.permission.v1`；注册和卸载不会碰其他 HTTP hook，包括仅仅叫 `duck` 的第三方条目。裸跑 `node hooks/codebuddy-install.js` 会保留已有、由该 marker 管理的自定义权限 URL；用 `--permission-url local` 可明确恢复本机 Duck 地址，用 `--permission-url https://example/permission` 可明确设置自定义 HTTP(S) 地址。

**WorkBuddy** — 使用与 Claude Code 兼容的 hooks，当前 WorkBuddy AI 的配置写入 `~/.workbuddy-ai/settings.json`，旧版使用 `~/.workbuddy/settings.json`。需要本机 WorkBuddy 追踪时，先到 **Settings → Agents** 安装；安装且启用后，Duck 才会在启动时继续同步 hooks。也可以手动执行 `node hooks/workbuddy-install.js`。WorkBuddy 是 macOS/Windows 的 Electron 桌面应用，没有独立的 Linux/WSL CLI；状态类动效已在 macOS 上验证可用。集成为**仅状态 + 通知**：桌面版审批始终由 WorkBuddy 原生沙箱与 GUI 确认卡片处理，因此 Duck 不会注册 `/permission` HTTP hook。权限请求只会以「等待确认」的 Notification 形式（带 `session_id`）传给 Duck——铃铛/提醒提示可用（已在 Windows 实测），但同意/拒绝的决定始终留在 WorkBuddy 内。

**opencode** — 使用 `~/.config/opencode/` 下当前生效的 plugin 配置：`config.json` → `opencode.json` → `opencode.jsonc`，后者优先。需要本机 opencode 追踪时，先到 **Settings → Agents** 安装；安装且启用后，Duck 才会在启动时继续同步 plugin。也可以手动执行 `node hooks/opencode-install.js`。

**Pi** — 使用全局 extension 目录 `~/.pi/agent/extensions/duck-on-desk`。需要本机 Pi 追踪时，先到 **Settings → Agents** 安装；安装且启用后，Duck 才会在启动时继续同步 extension。也可以手动执行 `npm run install:pi-extension`。交互式 Pi 会话会向 Duck 上报生命周期和工具活动，但 Pi 是 state-only：Duck 不显示权限气泡、不调用 Pi 终端确认，并保留 Pi 默认 YOLO 执行行为。

## 权限处理自动化

可从桌宠或托盘的 **权限处理** 子菜单选择 Duck 如何处理受支持的权限请求：

- **每次询问**：不自动作出任何决定。
- **仅提问弹窗**：自动批准显式支持 agent 的工具型请求，但问题与计划审阅仍等待你处理。Claude 使用已审阅的 built-in 列表，但并非每个受支持 adapter 都有逐工具 allowlist。
- **自动放行**：处理 adapter 判定为 automation-eligible 的请求。对 Claude，这包括名称非空但尚未识别的请求；缺失名称、不受支持的 decision shape，以及 CodeBuddy 的问题/计划仍回到原生流程。只有愿意交出这组更广的决定时才应开启。应用重启后会降级到 **仅提问弹窗**。

两种自动化模式都会先要求确认。Dashboard 还可以为每个符合条件的 live session 独立选择 **每次询问** 或仅工具模式。新 agent 不会因为声明了权限能力就自动获得自动化资格，但工具名的处理取决于 adapter 和模式。仅状态集成和由 agent 原生接管权限的流程不会被改变。

## WSL（Windows Subsystem for Linux）

如果 agent 跑在 WSL 里、Duck 跑在 Windows 宿主上，集成会向 `127.0.0.1:24333-24337` 上报。WSL1 天然共享这条 loopback；WSL2 通常需要镜像网络，默认 NAT 并不能让 Linux 访问 Windows 的 loopback 服务。应用内 Pair 会探测这条链路，并在安装成功但网络不可达时给出警告。

对于已支持的 agent，请在 **Settings → Agents** 的 Connected 区执行 **WSL Scan**，再找到对应发行版并点击 **Pair**。仅存在于 WSL 的 agent 仍可能位于 **Unavailable** 折叠区，因为本机安装状态与 WSL 配对是两套状态。Pair 会打开 Duck 的事件入口，但不会把它标记为 Windows 本机集成，也不会在 Windows 安装文件。

**配置步骤：**

```bash
# 在 WSL shell 中执行：
mkdir -p ~/.claude/hooks

# 从 Windows 侧的 Duck 仓库复制 hook 文件（按实际路径调整 /mnt/ 前缀）
cp /mnt/d/animation/hooks/{server-config,json-utils,shared-process,duck-hook,install,codex-hook,codex-install,codex-install-utils,codex-session-index,codex-subagent-fields}.js ~/.claude/hooks/

# 以远程模式注册 Claude hooks
node ~/.claude/hooks/install.js --remote

# 如果 WSL 中安装了 Codex CLI，也以远程模式注册 Codex official hooks
node ~/.claude/hooks/codex-install.js --remote
```

配置完成后，在 Windows 上启动 Duck，在 WSL 里运行 Claude Code —— Duck 会自动感知你的会话。权限气泡也能正常弹出。

应用内 WSL 部署路径会故意以不带 `--statusline` 的方式运行 Claude installer，因此只提供 transcript fallback，不宣称能拿到自定义 provider 的权威窗口。上面的手动 `--remote` 命令会在 WSL 的独立 home 中安装一条可见 statusline，但 Windows 端应用只有在 **采集本机 Claude 使用信息** 开启时才接受它的 context/quota metadata；开关关闭时这些 POST 会被当作成功 no-op。Windows 本机启动 reconcile 也无法移除 WSL 独立 home 里的 statusline。

如果 Codex 运行在 WSL 里，official hooks 需要安装到 WSL 自己的 `~/.codex` 下。如果你希望 WSL 与 Windows 共用同一份 Codex home，也可以在 WSL 里先设置 `CODEX_HOME=/mnt/c/Users/<windows-user>/.codex` 再运行 Codex。

### WSL 网络与 Hook 注册（替代方案）

Duck 跑在 Windows 的 Electron 应用里，而你的 AI 编程助手（Claude Code、Codex CLI 等）可能跑在 WSL 里。WSL 中的 hook 脚本会把 HTTP 请求发到 `127.0.0.1:24333`，所以 WSL 和 Windows 必须共享同一个 localhost。

- **WSL1** — 开箱即用。WSL1 天然与 Windows 共享 localhost，无需额外配置。
- **WSL2** — 需要镜像网络模式。WSL2 默认拥有独立网络栈，`127.0.0.1` 指向 WSL 自身而不是 Windows。请在 `%USERPROFILE%\.wslconfig` 中启用镜像模式（文件不存在就新建），然后执行 `wsl --shutdown` 重启 WSL：

```ini
[wsl2]
networkingMode=mirrored
```

**在 WSL 中手动注册 hooks：**

Duck 在 Windows 启动时会自动注册 Claude Code hooks 到 `~/.claude/settings.json`。但如果你的 Agent 跑在 WSL 里，hooks 需要注册到 WSL 自己的 home 目录。请在 WSL 中执行：

```bash
git clone https://github.com/rullerzhou-afk/duck-on-desk.git
cd duck-on-desk

# Claude Code
node hooks/install.js

# Codex CLI
node hooks/codex-install.js --remote

# CodeBuddy
# 保留已有、由版本化 marker 管理的自定义权限 URL
node hooks/codebuddy-install.js
# 明确指定目标：
# node hooks/codebuddy-install.js --permission-url local
# node hooks/codebuddy-install.js --permission-url https://approval.example/permission

# WorkBuddy
node hooks/workbuddy-install.js

# opencode
node hooks/opencode-install.js

# Pi
node hooks/pi-install.js
```

> 提示：如果仓库克隆在 WSL 内（如 `~/duck-on-desk`），hook 脚本会自动使用 WSL 的 Node.js 路径。如果仓库放在 Windows 盘里（如 `/mnt/c/...`），请确保 WSL 的 PATH 中有 `node`。

## Windows 说明

- **安装包**：GitHub Releases 提供独立的 Windows x64 和 Windows ARM64 NSIS 安装包。Intel / AMD Windows 设备下载 `Duck-on-Desk-Setup-<version>-x64.exe`，Windows on ARM 设备下载 `Duck-on-Desk-Setup-<version>-arm64.exe`。
- **自动更新**：Windows 安装包使用 `electron-updater`，更新时会保持当前匹配的架构。

## macOS 说明

- **源码运行**（`npm start`）：Intel 和 Apple Silicon 均可直接使用。
- **正式 DMG 安装包**：GitHub 正式 Release 同时提供 x64 与 arm64 DMG；发布工作流会用 Developer ID 签名、Apple 公证并 stapled。手动 `workflow_dispatch` 在没有签名凭据时可能只生成 ad-hoc 验证 artifact，不能当作正式安装包分发。
- **自动更新桥接**：旧版 DMG 没有 ZIP 更新载荷，不能把自己自动升级到首个支持应用内更新的版本。现有用户需要从 GitHub Releases 手动安装一次首个桥接版 DMG；装上桥接版后，后续正式版本可在 Duck 内下载，选择“立即重启”安装，或选择“稍后”并在退出、重新打开后完成。真实能力仍以同一 Developer ID 的 A→B 真机升级记录为准，不能用单元测试代替。
- **源码自动更新**：源码运行时，“检查更新”会执行 `git pull` + `npm install`（依赖有变化时）并自动重启。

## Linux 说明

- **源码运行**（`npm start`）：默认启用 Electron sandbox。如果你的 Linux 开发环境仍然遇到 chrome-sandbox 初始化失败，可临时使用 `DUCK_DISABLE_SANDBOX=1 npm start` 作为兼容方案。
- **安装包**：AppImage 和 `.deb` 可从 [GitHub Releases](https://github.com/rullerzhou-afk/duck-on-desk/releases) 下载。deb 安装后应用图标会出现在 GNOME 应用菜单。
- **终端聚焦**：依赖 `wmctrl` 或 `xdotool`（有一个就行）。安装：`sudo apt install wmctrl` 或 `sudo apt install xdotool`。
- **自动更新**：AppImage / deb 安装包仍需从 GitHub Releases 手动下载；源码运行时，“检查更新”会执行 `git pull` + `npm install`（依赖有变化时）并自动重启。
