# Duck on Desk

一只基于物理引擎的 3D Microduck，常驻你的桌面，实时响应你的 AI 编程 Agent —— Claude Code、Codex CLI、Pi 和 opencode。你提问时它思考，工具运行时它走动，Agent 需要审批时它冲你嘎嘎叫，出错时垂头丧气，你离开时它睡觉。

> AGPL-3.0 衍生自 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)（基线 commit `5ca26b5c`）。这只鸭子由 Pollen Robotics 官方 Microduck 仿真骨架、MuJoCo 物理引擎和强化学习行走策略驱动，不是预制帧动画。详见 `NOTICE.md`。

## 安装
见 `docs/guides/install.md`。支持 macOS（arm64/x64）与 Windows（x64/arm64）。

## 踩高跷（实验）

托盘菜单的「踩高跷」把鸭子换到社区训练的高跷策略
（`HannesVonEssen/microduck-stilts`，训练于 `Vottivott/microduck-playground`）。
和官方策略一样，它们只从你的 Hugging Face 缓存读取、不随应用打包，先取一次：

```bash
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('HannesVonEssen/microduck-stilts', allow_patterns=['*.onnx', '*.json', '*.md'])"
```

10–25 cm 是可打印的高度，50 cm–2 m 只是仿真结果。踩高跷时鸭子会走会转，
但不会坐下、啄地或自己爬起（摔倒后直接扶起），并把舵机增益加倍：所有 Microduck 策略都是用 BAM 舵机模型训练的，
官方策略能容忍本模拟器的 MJCF 位置执行器，高跷策略不能。

## Agent 支持
| Agent | 集成方式 | 状态 | 权限气泡 |
|---|---|---|---|
| Claude Code | `~/.claude/settings.json` 中的 command hooks + HTTP `PermissionRequest` hook | 全部 | 有 |
| Codex CLI | `~/.codex/hooks.json` 中的官方 hooks，JSONL 轮询兜底 | 全部 | 有 |
| opencode | `~/.config/opencode/` 中的 plugin | 全部 | 有（桥接） |
| Pi | `~/.pi/agent/extensions/duck-on-desk` 全局 extension | 仅状态 | 无（设计如此） |

## 状态如何驱动鸭子的行为
见 `docs/guides/state-mapping.zh-CN.md`。

## 皮肤
托盘 → Skin：Cream、Graphite、Lavender、Sky（Microduck 官方四种配色）。语音会随皮肤切换。

## 开发
`npm ci && npm run setup:models && npm start` · `npm test` · `npm run build:mac` / `npm run build:win:all`

## 许可证
代码采用 AGPL-3.0-only 许可。3D 素材与语音库仅限非商业使用（详见 `NOTICE.md`）。
