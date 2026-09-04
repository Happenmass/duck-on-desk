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
