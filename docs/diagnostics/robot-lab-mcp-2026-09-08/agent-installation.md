# Agent 管理页 MCP 安装验收 · 2026-09-08

实现：在各 Agent 展开项增加 Robot Lab MCP，支持安装／更新、刷新、移除和选填 Python 路径。Claude Code、Codex CLI、OpenCode 使用各自用户级配置；Pi 显示扩展需求。本机配置与 WSL／远端分别处理，本入口只配置本机。

- `DUCK_MCP_CODEX_BIN=/opt/homebrew/bin/codex npm test`：5,848 项，5,834 通过、0 失败、14 跳过。
- 最后一次打包映射修订后，配置与安装生命周期相关的 56 项测试全部通过。
- `npm run build:renderer`：通过。
- 真实 MCP startup check：8 个工具可读，未执行用户脚本或调用机器人环境。
- Claude／OpenCode 临时配置：安装、更新、回读、移除；原有 MCP、其他字段、注释、0600 权限保留；同名冲突、无效配置与重复键拒绝写入。
- Codex 官方 CLI＋临时 CODEX_HOME：空目录首次安装、已有配置更新、移除；其他 MCP 与 TOML 注释保留。
- 浏览器运行真实设置页源文件，以临时配置目录接真实安装器：Codex 展开 → 安装 → 显示“已配置”和更新／移除按钮 → 移除 → 恢复安装按钮。没有启动或重启 Electron，也未改用户实际 Agent 配置。
- macOS arm64 `electron-builder --dir` 构建通过；从安装包 `Contents/Resources/robot-lab-mcp/check.mjs` 直接启动，返回 `{"ok":true,"tools":8}`。仅构建验证，未发布／替换运行实例。

发现并修复两项问题：首次启动时不存在的 CODEX_HOME 被误报为 CLI 失败；electron-builder 的资源过滤器会跳过映射根部的 node_modules，需要单独的依赖映射。

配置“已配置”不等同于当前 Agent 会话已连接。用户需要重新打开会话，项目配置可能覆盖用户级条目。Python／PyTorch 不由安装器下载；Windows 分支仍待 Windows 实机验证。

入口：[MCP README](../../../mcp/robot-lab/README.md)。测试：`test/agent-mcp.test.js`、`test/settings-renderer-browser-env.test.js` 的 Agent MCP controls。
