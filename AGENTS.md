# AGENTS.md

duck-on-desk 是 Clawd on Desk（AGPL-3.0）的衍生：保留其 hook/HTTP 状态服务、多会话状态机、权限气泡与设置系统，把渲染层换成物理驱动的 3D Microduck。首发 agent：Claude Code、Codex CLI、Pi、opencode。首发平台：macOS、Windows。

## Commands

npm start · npm test · npm run build:mac · npm run build:win:all · npm run install:claude-hooks · npm run install:codex-hooks · npm run install:pi-extension · node hooks/opencode-install.js · scripts/smoke-state.sh

## Runtime summary

- hook → `POST 127.0.0.1:24333-24337 /state|/permission`；端口写 `~/.duck-on-desk/runtime.json`；响应头 `x-duck-server: duck-on-desk`
- `src/state/server.js` → `server-route-state.js` → `agent-runtime-main.js` → `state.js` → IPC → 渲染窗；权限 `server-route-permission.js` → `permission.js`
- `agents/registry.js` 的 capabilities 是权限/subagent 路由权威；`src/state/integration-sync.js` 只同步 codex/opencode/pi；Claude Code 走 `claude-settings-watcher.js` + `claude-hook-operations.js` 队列
- 设置：`prefs.js`（schema v20）→ `settings-controller.js`（唯一写入者）→ `settings-store.js`
- 渲染：Plan 02 之前是 `src/shell/renderer.js` + `themes/duck`（螃蟹精灵）；之后是 `renderer/`（Vite + Three.js + MuJoCo）经 `state-change` / `pet-visual-settled` 契约驱动

## Constraints

- Claude Code / Codex 阻塞式权限走 `POST /permission`；无决定回 204 或断连，绝不伪造 deny
- 注册 Claude Code hook 必须 marker（`duck-hook.js`）范围合并，不得覆盖用户条目
- hook 脚本只依赖 Node 内置模块与 `hooks/` 内的纯 Node helper
- Pi 是 state-only：不接管权限、不弹权限气泡
- Codex official hooks 为主，JSONL 轮询为兜底；`codex-turn-fence.js` 去重
- 设置 store 是唯一真相，controller 是唯一写入者
- `~/.claude/settings.json` 的所有进程内 mutation 必须经 `src/state/claude-hook-operations.js` 串行队列
- 不得把 ONNX 权重复制进仓库或安装包；只从用户级 Hugging Face 缓存读取
- 实验室可调训练参数不添加未经用户要求的人为上限；推荐值只作默认值。训练轮数（含续训累计）、并行数量、采样步数与训练时长不设产品上限，只保留数据类型、算法和模型的必要约束。

## Testing

`npm test`（node:test，120 s per-test 超时，`DUCK_TEST_TIMEOUT_MS` 覆盖）；透明窗口、托盘、拖拽与权限气泡以人工验证为主，`scripts/smoke-state.sh` 做状态注入冒烟。
