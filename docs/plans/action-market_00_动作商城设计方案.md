# 动作商城：融入 Microduck 社区策略生态

状态：设计方案 v0.1，2026-09-16。目的：在桌宠设置菜单中提供动作商城，浏览、下载、试播、启用社区 Microduck 策略，并把本地训练成果上传共享。
需求来源：用户要求「像 skill 商城一样」共享训练动作；在托管方案上用户明确选择「融入已有生态」，不另建封闭 tag。

## 0. 前置调研结论（2026-09-16 实测）

调研遵循 AGENTS.md「先检查官方是否已有，不得未检查就自行设计替代方案」。

| 事实 | 数据 | 来源 |
|---|---|---|
| Hugging Face 上已有 Microduck 策略生态 | `microduck` tag 55 个仓，`microduck-policy` tag 34 个仓 | `GET /api/models?filter=...` |
| 已有事实标准共享格式 | 仓内 `manifest.json`，含 `model_api: 1` | RemiFabre/microduck-flamingo-cycle 等 |
| Pollen 核心成员在带头使用 | RemiFabre（pollen-robotics）多个仓 | 仓库 author 字段 |
| 规范文档尚未合并 | README 引用的 `microduck_rl/docs/sharing-policies.md` 在 develop 分支 404 | GitHub contents API |
| schema 仍在演进 | RemiFabre `schema_version: 2`，HannesVonEssen `schema_version: 5` | 两仓 manifest.json |
| 部分仓无 manifest | fffiloni、zhoumiaosen 的仓只有 onnx + 自定义 json | 仓库 tree |

结论：**不自造 `.duckaction` 格式**，采用社区既有 `manifest.json`；兼容判断认稳定字段 `model_api`，不认 `schema_version`；必须能对无 manifest 的仓优雅降级。

## 1. 术语

| 词 | 本文含义 |
|---|---|
| 策略包 | HF 上一个模型仓的一个 commit，含 `policy.onnx` 及可选 `manifest.json`、`media/` |
| 步态策略 | `kind: perpetual` 且 `duration_s: null`，持续运行，替换桌宠行走策略 |
| 动作策略 | 有限时长，播放一次后回到站立，进入桌宠动作库 |
| L1 发现 | HF models API 实时查询，去中心化，不代表可信 |
| L2 索引 | 我们维护的精选清单，只收本地复现验收过的条目 |
| 准入 | 本地实验室跑过评测后，用户确认加入桌宠 |

## 2. 目标与范围

- G1：设置菜单「动作」子菜单新增「动作商城…」，打开可浏览 55+ 社区策略的界面。
- G2：下载的策略先落本地缓存并校验 sha256，在实验室试播后才可进入桌宠。
- G3：本地训练产物可一键上传为符合社区格式的 HF 仓。
- G4：全程不放宽实验室窗口 CSP，不在渲染进程直连外网。

本版不做：评分/评论系统、下架后台、跨机器人（Reachy）、真实硬件部署（社区仓里的 `control.py` 一律不执行）。

## 3. 包格式

### 3.1 读取（消费社区仓）

必需：`policy.onnx`（`obs[1,61] f32 → actions[1,14] f32`，归一化已烘焙）。

从 `manifest.json` 读取并必须校验：

| 字段 | 用途 | 缺失时 |
|---|---|---|
| `model_api` | 契约版本，仅接受 `1` | 判为「未声明契约」，进入待确认区 |
| `obs_len` / `action_len` | 必须为 61 / 14 | 拒绝 |
| `kind` / `duration_s` | 区分步态策略与动作策略 | 默认按步态处理 |
| `entry_pose` | 对应 `ActionSequence` 的 settling 前置 | 默认 `standing` |
| `action_scale` | 与 `ctrl = default_pose + output × scale` 对齐 | 默认 1.0 |
| `command.idle` | 空闲指令向量 | 默认全零 |
| `robot.model` / `control_hz` | 必须 `microduck` / 50 | 拒绝 |
| `training` / `eval` | 详情页展示来源与已知限制 | 展示「作者未提供」 |

无 `manifest.json` 的仓：仍可下载，但只能走「未声明契约」路径——加载后用零观测探针验证张量形状，并强制走完整本地评测，界面明确标注风险。

### 3.2 写入（上传本地训练成果）

生成符合社区约定的仓：`policy.onnx` + `manifest.json`（`model_api: 1`）+ `media/preview.mp4` + `README.md`，tag 打 `microduck` / `microduck-policy` / `mjlab` / `duck-on-desk`。

我们自己的实验室元数据（`reward_weights`、完整 `ppo` 配置、`curricula`、`native_evaluation_passed`、`baseline`/`candidate`）作为附加文件 `duck-lab/manifest.json` 与 `duck-lab/input.json` 并存，不塞进社区 manifest。

上传前必须脱敏：现有 `input.json` 的 `asset_dir` 等字段含用户绝对路径（实测形如 `C:\Users\<name>\...`）。

## 4. 聚合架构

```
L1 发现   GET huggingface.co/api/models?filter=microduck-policy&full=true
          → 单次请求即得 id / sha / siblings / likes / downloads / lastModified / tags
L2 索引   index.json（HF dataset 仓或 GitHub raw）
          → [{repo, revision(sha), policy_sha256, 本地评测数据}]，驱动「精选」分区
L3 缓存   ~/.cache/huggingface/duck-market/<owner>/<repo>/<sha>/
          → 复用 ensureCachedPolicy 的下载+校验+原子改名模式
```

要点：

- `full=true` 返回的 `siblings` 让我们**在下载任何权重前**判断仓内有没有 `policy.onnx` / `manifest.json`，不必对每个仓再调 tree 接口。
- 所有下载用 `resolve/<sha>/...` 固定 commit，与 policy-cache.js 现有 pin `183f99a4…` / `5b47fa1a…` 的做法一致。
- tag 谁都能打，**只用于发现，绝不用于信任**；信任只来自 L2 里我们自己跑出的评测记录。
- 列表结果本地缓存 + TTL（建议 6 小时）+ `If-None-Match`，离线时回落上次结果。
- `manifest.json` 逐个拉取（~2 KB），并发上限 4–6，按 `sha` 永久缓存（commit 不变则内容不变）。

## 5. 模块与文件

新增：

| 文件 | 职责 |
|---|---|
| `src/market/hub-client.js` | HF models API 查询、ETag/TTL 缓存、并发限流。**只在主进程**，用 Node fetch |
| `src/market/manifest.js` | manifest 解析与校验，归一成本地条目；纯函数，便于 node:test |
| `src/market/index-client.js` | L2 精选索引拉取与校验 |
| `src/market/install.js` | 按 sha 下载 policy.onnx，大小上限、sha256 校验、原子落盘 |
| `src/market/store.js` | `~/.duck-on-desk/robot-lab/market-actions.json`，已安装条目 |
| `src/shell/market-ipc.js` | `market:request` 通道，参照 robot-lab-window.js 的 `trusted()` 校验 |
| `src/preload-market.js` | 仅暴露 `request` |
| `renderer/market.html` + `renderer/src/market.js` | 界面；vite 第三个 rollup 入口 |

改动：

| 文件 | 改动 |
|---|---|
| `src/shell/menu.js:244` 附近 | 「动作」子菜单在「训练 / 管理动作…」旁新增「动作商城…」 |
| `src/robots/duck/policy-cache.js` | `resolvePolicyRequest` 新增 `market/<owner>/<repo>/<sha>/policy.onnx` 路由 |
| `src/robots/duck/pet-model-protocol.js` | 新增 `pet-market://` 协议代理 HF 媒体（预览图/视频），使窗口 CSP 保持 `img-src 'self'`，不放宽为 `https://huggingface.co` |
| `renderer/src/runtime/duck-runtime.js:540` | `setActions` 的 id 正则 `^run_[a-f0-9-]{36}$` 需放行商城条目（如 `mkt_<sha12>`）；校验从 `duck-lab-action-v1` 扩展为同时接受 `model_api:1` |
| `mcp/robot-lab/jobs.cjs` | `actions()` 合并本地训练动作与已准入商城动作 |
| `src/shell/i18n.js` | 新增菜单与界面文案 |

窗口形态：复用 `createRobotLabWindow` 的模式新开独立窗口（`market.html`），不塞进实验室 tab——商城面向普通用户，实验室是开发者模式入口（`openActionLab` 会顺手打开 `developerMode`）。

## 6. 准入与安全

必须全部满足才允许进入桌宠：

1. 下载体积上限（建议 ≤ 8 MB）、`policy.onnx` sha256 与 manifest/`SHA256SUMS` 一致。
2. 加载后零观测探针：`obs[1,61]` → `actions[1,14]` 且全部有限（`playAction` 已有这段逻辑，复用）。
3. `robot.model === 'microduck'`、`control_hz === 50`、形态为 0cm 腿；高跷/滚轮状态下不提供。
4. 在实验室中完成本地评测或用户明确试播确认，写入本地条目——**绝不采信作者仓里的 eval 字段作为准入依据**（对照：现有 `addAction` 要求 `evaluation.runId === id`，别人的评测结果不能当我们的凭据）。
5. 步态策略走现有 `apply()` 路径，保留对照评测与 `rollback()`；商城下载的策略**不得自动 apply**。
6. 社区仓里的 `control.py`、`*.pt` 一律不下载、不执行。

## 7. 一个待决的技术约束：指令语义不可机读

`command.twist/head/body` 在 manifest 里是**自由文本描述**，不是机读 schema。例如 flamingo-cycle 的 `twist = [flag, side, 0]` 与我们行走用的 `[vx, vy, yaw]` 完全不同语义，直接用桌宠的行走指令驱动它会得到错误行为。

决策（用户 2026-09-16 选择 A）：只自动接受两类，其余照常展示、允许下载与实验室试播，但**不提供一键加入桌宠**，列表标注「需要手动映射」。首版不做通用指令映射 UI——那与「点一下就能用」的商城定位冲突，且要求用户读懂英文技术说明。两类为——

- 动作策略：`command.idle` 全零且 `duration_s` 有限 → 按 `official-zero-commands-v1` 路径播放。
- 步态策略：manifest 声明 twist 为速度语义（需建立一个小的已知任务白名单，如 `Mjlab-*-Flat-MicroDuck` 速度跟踪族）→ 接入现有行走指令。

长期对策：向 pollen-robotics 提 issue/PR，推动 `command` 增加机读字段（如 `twist.semantics: "velocity"`）。白名单随之自然扩大，通用映射 UI 留待确有需求再做。这也是融入生态应有的反哺。

补充依据：同一组槽位承载不同语义并非社区特例，本仓自身即如此——`renderer/src/runtime/duck-runtime.js:1006` 起，行走、坐站、啄地、动作播放、滚轮五种情形对前 3 个槽位有五种不同定义。喂错不会抛错：形状与有限性校验全部通过，只是产生不可预期的动作，因此不能把散文解析放在准入闸门上。

## 8. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 只读浏览 ✅ 2026-09-16 | hub-client + manifest 解析 + 列表/详情界面 + 媒体代理；不下载权重 | 已达成：34 个仓全部列出，判定 8 可用 / 17 需手动映射 / 8 未声明契约 / 1 无权重；冷启动 4.7 s，缓存命中 1 ms |
| M2 下载与试播 ✅ 2026-09-16 | install.js + pet-model 路由 + 实验室试播 + 准入 | 已达成：真实下载 joanfox/microduck-happy-hop（793,778 字节，摘要一致），协议解析 200，未试播不进桌宠 |
| M3 桌宠集成 | 准入流程 + 动作库合并 + 菜单/随机播放 | 下载的动作出现在右键菜单并能播放；可移除 |
| M4 上传 | HF token 配置 + 仓创建 + manifest 生成 + 脱敏 | 本地一个训练产物成功发布并能被 M1 的列表发现 |
| M5 精选索引 | L2 index.json + 分区展示 | 精选区只显示本地复现过的条目 |

M1 独立可用（纯浏览也有价值），M4 依赖用户自备 HF 账号与 write token。

## 9. 未决问题

1. L2 索引托管在 HF dataset 仓还是项目 GitHub raw？倾向 HF，与下载同源、同一套离线策略。
2. ~~上传的许可证~~ 已定（用户 2026-09-16）：上传沿用 AGPL-3.0。连带事项——由官方 apache-2.0 策略微调而来的动作，需在包内保留上游归属声明与来源 commit（`training` 字段本就要求），M4 实现时一并处理。
3. 是否向社区 tag 反向贡献我们的 `duck-lab/` 扩展字段约定，还是保持为私有附加文件。
4. HF API 未鉴权时的速率限制，需实测并决定是否在 M1 就引入可选 token。

## 10. M1 实现记录（2026-09-16）

新增：`src/market/manifest.js`（契约判定）、`hub-client.js`（目录与缓存）、`catalog.js`（排序与媒体地址）、`media-protocol.js`（`pet-market://` 代理）、`src/shell/market-window.js`、`src/preload-market.js`、`renderer/market.html` + `src/market.js` + `src/market.css`。
改动：`src/main.js`（协议注册与窗口装配）、`src/shell/menu.js`（动作子菜单新增入口）、`src/shell/i18n.js`（三语文案）、`renderer/vite.config.js`（第三个构建入口与开发中间件）。
测试：`test/market-{manifest,hub-client,media-protocol,catalog,window}.test.js`，共 42 项，全部通过。

判定规则据实调整了两处，均因真实数据与初版设计不符：

- `robot.model` 不是枚举而是描述串（实测取值 `microduck` / `microduck full_shell` / `microduck passive rollers`）。改为按首个词元识别机器人，其余词元视为机身限定词：滚轮/高跷类归 `foreign-morphology`，其他限定词归 `body-variant`，都不开放一键使用。
- `model_api` 在野外已出现 2，且 7 个仓完全没有该字段。未知或缺失一律归为「未声明契约」而不是拒绝，代价是用户多跑一次本地评测，而不是看不到这个条目。

一个反向验证：社区的 `tfrere/microduck-move-base-ground-pick` 被判为 `episodic-command-unknown`。这是正确的——本仓自己的啄地策略正是用 `[cos, sin, 0]` 相位驱动的，若按「有时长就喂零」处理会得到错误动作。该用例已固化为测试。

## 11. M2 实现记录（2026-09-16）

新增：`src/market/install.js`（下载与校验）、`src/market/store.js`（已下载记录与准入状态）、`renderer/src/runtime/action-catalog.js`（动作准入过滤）。
改动：`src/robots/duck/policy-cache.js`（market 路由）、`renderer/src/runtime/duck-runtime.js`（准入过滤下沉、试播计量、商城时长）、`src/shell/market-window.js`、`src/shell/robot-lab-window.js`、`src/main.js`、`renderer/src/market.js`、`renderer/src/lab.js`、`renderer/lab.html`。
测试：`test/market-install.test.js`(11)、`test/market-store.test.js`(10)、`test/action-catalog.test.js`(6)、`test/market-window.test.js`(+5)、`test/pet-model-protocol.test.js`(+3)。

### 完整性锚点：用 Hub 的 LFS oid，不用作者的自述

实测 2026-09-16：带 `microduck-policy` 标签且有 `policy.onnx` 的 33 个仓**全部**使用 Git LFS，而 LFS 的 `oid` 就是文件内容的 sha256（已用真实下载比对确认）。因此在下载任何字节之前，就能从 `/api/models/<repo>/tree/<revision>` 拿到确切体积与摘要。体积不符或摘要不符的文件永远不会落到最终路径。作者 manifest 里的 `eval` 字段不参与任何校验。

### 两道闸门，不能合并

`downloaded` 与 `admitted` 是两个状态：前者只表示权重已落盘且摘要正确，后者表示**用户在本机实验室里看着它跑完一遍并确认接受**。只有 `admitted` 能进桌宠右键菜单。这与实验室对本地训练动作的既有规则一致（`addAction` 要求 `evaluation.runId` 属于本机这次训练）。试播计量取自 `duck-runtime` 真实运行的控制步数、输出路数与有限性，不取自任何声明。

### 只播零指令动作

`normalizeActionCatalog` 只接受 `commandMode === zero-commands` 的商城策略。速度类步态与自定义标志位类策略可以下载、可以在仓库页查看，但不进入播放路径——理由见第 7 节。
