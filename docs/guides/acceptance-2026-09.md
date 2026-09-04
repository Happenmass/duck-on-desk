# v0.1.0 接入验收记录（2026-09）

四个 agent 各跑一次真实会话，对照下表逐行填写。「期望」由计划给定，「实际」写你看到的现象，「通过」填 ✅ / ❌（❌ 时在行尾补一句原因）。

前置：`npm ci && npm run setup:models`，本机已装对应 agent CLI。每个小节先跑「安装与核对」再跑真实会话。

---

## Claude Code

### 安装与核对

```bash
cd /Users/guhappen/自媒体运营/duck-on-desk
npm run install:claude-hooks && node scripts/check-claude-hooks.mjs
```

| # | 步骤 | 期望 | 实际 | 通过 |
|---|---|---|---|---|
| 1 | `npm run install:claude-hooks` | 命令退出码 0，报告写入 `~/.claude/settings.json` | | |
| 2 | `node scripts/check-claude-hooks.mjs` | 退出码 0；`missingEvents: []` | | |
| 3 | 同上报告的 `permissionUrl` | 形如 `http://127.0.0.1:2433X/permission`，端口在 24333–24337 之间 | | |
| 4 | 同上报告的 `userEntriesPreserved` | 等于你安装前 `~/.claude/settings.json` 里自定义 hook 的条数（未被覆盖） | | |

### 真实会话（`npm start` 后在任意终端运行 `claude`，输入一个需要读文件与写文件的任务）

| # | 触发 | 期望状态 | 期望鸭子行为 | 实际 | 通过 |
|---|---|---|---|---|---|
| 1 | 提交提示词（UserPromptSubmit） | `thinking` | 面朝镜头（heading 0）东张西望，每 1.5 s 随机看一处 | | |
| 2 | 工具开始执行（PreToolUse/PostToolUse） | `working` | 原地行走（forward 0.7，heading 0） | | |
| 3 | Claude 请求写文件权限（PermissionRequest） | `notification` | 权限气泡弹出；鸭子面朝镜头连续叫（每 2.5 s 一次 quack） | | |
| 4 | 点 **Allow** | — | 气泡消失，Claude 终端继续执行并完成写入 | | |
| 5 | 任务结束（Stop） | `attention` → `idle` | 叫一声后回到 AutonomyAdapter 自主动作 | | |
| 6 | 重跑一次同样的任务，这次点 **Deny** | — | 气泡消失；Claude 终端显示权限被拒绝，未写文件 | | |

备注：

---

## Codex CLI

### 安装与核对

```bash
cd /Users/guhappen/自媒体运营/duck-on-desk
npm run install:codex-hooks && node scripts/check-codex-hooks.mjs
```

| # | 步骤 | 期望 | 实际 | 通过 |
|---|---|---|---|---|
| 1 | `npm run install:codex-hooks` | 命令退出码 0；`~/.codex/hooks.json` 写入六个受管事件，`~/.codex/config.toml` 打开 hooks 特性 | | |
| 2 | `node scripts/check-codex-hooks.mjs` | 退出码 0；`missingEvents: []` | | |
| 3 | 同上报告的 `managedEvents` | 恰好是 `SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop` | | |
| 4 | `~/.codex/hooks.json` 里你原有的自定义 hook | 仍在原位，未被覆盖 | | |

### 真实会话（官方 hooks 路径：`npm start` 后在任意终端运行 `codex`，让它完成一个写文件任务）

| # | 触发 | 期望状态 | 期望鸭子行为 | 实际 | 通过 |
|---|---|---|---|---|---|
| 1 | 提交提示词（UserPromptSubmit） | `thinking` | 面朝镜头（heading 0）东张西望，每 1.5 s 随机看一处 | | |
| 2 | 工具开始执行（PreToolUse/PostToolUse） | `working` | 原地行走（forward 0.7，heading 0） | | |
| 3 | Codex 请求写文件权限（PermissionRequest） | `notification` | 权限气泡弹出；鸭子面朝镜头连续叫（每 2.5 s 一次 quack） | | |
| 4 | 点 **Allow** | — | 气泡消失，Codex 终端继续执行并完成写入 | | |
| 5 | 任务结束（Stop） | `attention` → `idle` | 叫一声后回到 AutonomyAdapter 自主动作 | | |
| 6 | 重跑一次同样的任务，这次点 **Deny** | — | 气泡消失；Codex 终端显示权限被拒绝，未写文件 | | |

### JSONL 兜底（关掉官方 hooks 再跑一次同样的任务）

关闭方式二选一：托盘 → Settings → Agents 关掉 Codex official hooks；或临时把 `~/.codex/hooks.json` 改名（验收后改回）。

| # | 触发 | 期望状态 | 期望鸭子行为 | 实际 | 通过 |
|---|---|---|---|---|---|
| 1 | 关闭官方 hooks 后 `node scripts/check-codex-hooks.mjs` | 退出码 1；`missingEvents` 列出六个事件（确认这一轮确实走兜底） | | |
| 2 | 提交提示词 | `thinking` | 面朝镜头东张西望；相对官方 hooks 有约 1.5 s 的轮询延迟 | | |
| 3 | 工具开始执行 | `working` | 原地行走；同样带约 1.5 s 延迟 | | |
| 4 | Codex 请求权限 | — | 以只读问题卡形式出现（无 Allow/Deny 按钮），需在 Codex 终端里自己决定 | | |
| 5 | 任务结束 | `attention` → `idle` | 叫一声后回到自主动作 | | |
| 6 | 验收后恢复 | 重新打开 Codex official hooks（或把 `hooks.json` 改回），`node scripts/check-codex-hooks.mjs` 退出码 0 | | |

备注：
