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

## Robot Lab course development

- 新课程先检查官方 Microduck / mjlab 仓库是否已有对应任务、训练脚本、模型与验证记录，记录来源及版本；不得在未检查前自行设计替代方案。
- 官方已有对应脚本时，优先直接复用官方源码与完整训练配方，先建立官方基线。环境、碰撞模型、观测、动作、初始化、奖励、重置、PPO 与课程表保持一致；应用层只做必要的启动、进度、保存和展示适配，不悄悄改变训练语义。
- 官方没有对应任务时，才设计新课程；必须深入参考官方实现，以最接近且已有验证依据的脚本为基础扩展，明确复用部分、新增部分及验证依据，不从零臆造配方。
- 对官方基线的任何实验性修改须说明理由、差异和验证计划，取得用户明确指示后再实施；保留原始官方基线与历史记录，改版不得标称为原版官方复现。用户明确要求的改动也应记录为偏离官方基线的实验。
- 区分“官方有脚本”“训练链路已跑通”和“动作成功率已验证”；冒烟测试通过不等于课程已成熟或动作已学会。

## Testing

`npm test`（node:test，120 s per-test 超时，`DUCK_TEST_TIMEOUT_MS` 覆盖）；透明窗口、托盘、拖拽与权限气泡以人工验证为主，`scripts/smoke-state.sh` 做状态注入冒烟。
