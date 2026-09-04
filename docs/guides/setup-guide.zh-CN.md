# 配置指南

[返回 README](../../README.zh-CN.md)

## 本地服务

Duck 会在 `127.0.0.1` 上起一个本地 HTTP 服务，在 `24333`-`24337` 中选取第一个空闲端口。选中的端口会写入 `~/.duck-on-desk/runtime.json`，内容为 `{"app":"duck-on-desk","port":<port>,"ownerPid":<pid>}`；服务的每个响应都带有 `x-duck-server: duck-on-desk` 响应头。Hooks、Codex 安装器、opencode plugin 和 Pi extension 都通过读取 `runtime.json` 获取当前端口，而不是硬编码端口号。

## Agent 配置说明

全新安装默认只安装并启用 Claude Code 和 Codex。opencode 和 Pi 需要先到 **Settings → Agents** 点该 agent 的 **Install / 安装**；安装且启用后，Duck 才会在启动时继续同步对应 hook / plugin / extension。单独关闭 agent 只会停止事件入口，不会卸载文件；**Uninstall / 卸载** 只删除 Duck 管理的 hook / plugin / extension 条目，并同时禁用该 agent。

**Claude Code** — 开箱即用。Duck 启动时会自动注册 hooks。只有在确认 Claude Code 版本兼容时才会注册 versioned hooks（`PreCompact`、`PostCompact`、`StopFailure`）；如果版本无法确认，会自动回退到核心 hooks，并清理旧的不兼容条目。除了监听 `~/.claude/settings.json` 所在目录的变化外，Duck 还会每 5 分钟做一次只读健康巡检——即使 hook 脚本是在系统 Temp 等其他目录被清理、且 `settings.json` 本身完全没变化，也能发现并自动修复。同一问题连续自动修复 3 次仍失败会停止自动重试，Doctor 会提示手动 Fix；如果是当前安装包自身的 hook 脚本缺失（例如安装损坏），Duck 不会盲目重写配置，会提示重新安装或重新解压。

**Codex CLI** — 开箱即用。Duck 会在检测到 Codex 时自动注册 official hooks 到 `~/.codex/hooks.json`，并在用户没有显式关闭 hooks 时启用 `[features].hooks = true`。Installer 会把已废弃的 `[features].codex_hooks` 迁移到 `hooks`，同时保留用户显式设置的 false。本机安装使用 `~/.codex/duck-hooks/` 下的稳定平台条目：Windows 在 Codex 已有的 PowerShell 命令进程里读取一份托管的 UTF-8/Base64 数据 sidecar（并配有独立的 JSON 健康档案供 Doctor 使用），POSIX 则使用一个小型 `/bin/sh` wrapper 加健康档案；不会执行未签名的 `.ps1`。**Settings → Agents → Codex → 随 Codex 启动** 单独控制本机 Codex 的 `SessionStart` 能否在 Duck 未运行时拉起桌宠；关闭它不会停用状态或审批接入，Duck 已运行时仍然正常工作。`~/.codex/sessions/` JSONL 轮询只保留为状态 / metadata fallback，用于 hook 被禁用或 hook 未覆盖事件；审批不再从 JSONL 猜测。Codex 发出 `request_user_input` 时，Duck 会从 transcript 中识别该调用，播放通知反应并显示问题/选项的只读预览。回答仍在 Codex 原生界面中完成，卡片不会注入选择；匹配的工具输出写入后会自动关闭。

**opencode** — 使用 `~/.config/opencode/` 下当前生效的 plugin 配置：`config.json` → `opencode.json` → `opencode.jsonc`，后者优先。需要本机 opencode 追踪时，先到 **Settings → Agents** 安装；安装且启用后，Duck 才会在启动时继续同步 plugin。也可以手动执行 `node hooks/opencode-install.js`。

**Pi** — 使用全局 extension 目录 `~/.pi/agent/extensions/duck-on-desk`。需要本机 Pi 追踪时，先到 **Settings → Agents** 安装；安装且启用后，Duck 才会在启动时继续同步 extension。也可以手动执行 `npm run install:pi-extension`。交互式 Pi 会话会向 Duck 上报生命周期和工具活动，但 Pi 是 state-only：Duck 不显示权限气泡、不调用 Pi 终端确认，并保留 Pi 默认 YOLO 执行行为。
