# Duck on Desk A/B 探针：几何量是不是渲染成本？（2026-09-08）

## 结论

**不是。减面和减 draw call 都省不出可测量的收益。**

- 把三角形从 198,452 降到 852（−99.6%）、draw call 保持 71 不变：总 CPU **+0.31 个百分点**，即无变化。
- 把 draw call 从 71 降到 28（−61%）、三角形同时降 59%：总 CPU **−0.77 个百分点（−3.4%）**。
- 同一条件内部的样本极差是 **2.16 个百分点**，比上面两个效应都大。两者都无法与噪声区分。

因此 A1 测出的那条「绘制」开销带是**每帧固定成本，与场景里画了什么基本无关**。减面管线（`meshes-lite/`）不值得建；`HIDDEN_MESHES` 按性能理由也不值得填。

同时，逐 mesh 像素差推翻了「壳内不可见零件占 62%（115,880 三角形 / 44 个 draw call）」这一说法——那是从零件名推断的，未在本 rig 上验证。真正在 8 个 yaw 角下都是 0 像素变化的只有 **4 个 mesh / 9,154 三角形（4.6%）**。15 个 `xl330.stl` 舵机的像素贡献量在全部零件中排第二。

本轮只做诊断，未修改正式代码、未改变外观或物理行为、未实施任何优化。

## 条件与方法

- 工作区 HEAD `3f64edf`，运行实例 v0.2.2 / Electron 41.10.4 / Chromium 146.0.7680.216，Apple M3 Max，14 逻辑核，120 Hz 内屏，宠物窗 156×156 CSS px、DPR 2（**后缓冲 312×312 = 97,344 像素**）。Duck classic、legs、无高跷、清醒 walk 模式。
- 与 A1 不同，本轮**未重建 renderer**：通过主进程 Node inspector → `webContents.debugger` → `Runtime.callFunctionOn`，在运行中的实例上直接改场景图。`window.__duckRuntime` 的私有字段中 `#i`=Scene、`#r`=WebGLRenderer、`#a`=Camera、`#o`=rig。
- 姿态固定用 runtime 自己的租约：`command({type:'move',source:'local',forward:0,heading:0,ttlMs:3600000})`。`local` 优先级 100 高于 system roam 的 90 和 autonomy 的 10。每个样本前后各断言一次，并校验 `motionSource === 'local'`。
- **窗口移动被拦截**：首轮预备测量中宠物窗在 60 秒内被移动了（x 290→1556），但 `motionSource` 全程是 `local`、`forward=0`——说明主进程 roam 独立于渲染层位移上报驱动窗口。正式测量前把窗口 1 和 3 的 `setBounds`/`setPosition` 用自有属性覆盖为计数空操作，测完 `delete` 还原。全程共拦截 96 次 `setBounds`，若不拦截会污染 GPU 进程读数。
- 每样本预热 8 秒、采样 60 秒，3 个条件 × 3 次、轮换顺序。CPU = `100 × Δapp.getAppMetrics().cpu.cumulativeCPUUsage / Δ墙钟秒`，100% 表示占满一个核；**GPU 行是该进程的 CPU 占用，不是 GPU 利用率**。
- 每样本校验：实际绘制帧数（全部 1800 或 1801 = 30 fps × 60 s）、`renderer.info.render.calls` 等于该模式应有值、未睡眠、`motionSource`、窗口 bounds 未变。

### 三个条件

| 模式 | 做法 | draw call | 三角形 |
|---|---|---:|---:|
| `baseline` | 不改 | 71 | 198,452 |
| `hide-internal` | 15 个内部件名 `visible = false` | 28 | 81,676 |
| `tiny-geom` | 全部 mesh `geometry.setDrawRange(0, 36)` | 71 | 852 |

`hide-internal` 是**上界探针**，不是可发布的集合：它无差别删掉全部内部件并接受可见劣化，用来测这条路线的天花板。`tiny-geom` 用 `setDrawRange` 而非替换几何，因此对象数、材质、状态设置、绑定的缓冲全部不变，只有实际绘制的三角形数变化——两条轴由此分离。

## 结果

单核百分比，均值（最小–最大）。

| 模式 | n | renderer | GPU 进程 | 合计 | 相对 baseline |
|---|---:|---:|---:|---:|---:|
| baseline | 3 | 14.31 (13.98–14.65) | 8.51 (8.30–8.63) | 22.82 | — |
| hide-internal | 3 | 13.94 (13.62–14.18) | 8.11 (7.89–8.24) | 22.05 | −0.77（−3.4%） |
| tiny-geom | 2 | 14.54 (13.46–15.62) | 8.59 (8.15–9.03) | 23.13 | +0.31（+1.4%） |

主进程 0.35–0.82，各条件间无系统差异。

第 3 个 `tiny-geom` 样本（rep0）被判无效并排除：采样中途 `motionSource` 从 `local` 变为 `system`，即 local 租约被某处 `clearAll()` 清掉、系统租约接管。其读数为 renderer 13.35 / GPU 7.93，落在其它样本区间内，但条件不一致，不并入统计。未追查清租约的调用点。

## 逐 mesh 像素差

在真实后缓冲 312×312、8 个 yaw 角（0 到 7π/4）下，对每个 mesh 名做「显示 / 隐藏」两次渲染。两次渲染在同一次同步调用内完成，姿态完全一致，仅可见性不同；用 `gl.readPixels` 读回默认帧缓冲比较。

- **8 个角度全部 0 像素变化（4 个名 / 4 个实例 / 9,154 三角形 = 4.6%）**：`elec_rpi_robot_hat_pcb.stl`、`m12_lens_holder.stl`、`jaw_soft.stl`、`speaker.stl`
- 变化像素数最多的前几名：`xl330.stl` 17,364、`top_head_shell.stl` 12,368、`sole_left.stl` 5,340、`jaw.stl` 5,108
- 被推断为「壳内不可见」但实测可见：`xl330.stl`（15 个）、`seeed_bearing__configuration__22x16x4.stl`（11 个、57,211 面）2,004 像素、`np_f970.stl` 1,217 像素、`power_support.stl` 1,553 像素

「变化像素数」是 8 个角度之和，分母为 8 × 97,344 = 778,752。完整数据见 `pixeldiff.json`，场景清单见 `inventory.json`。

## 证据

- `matrix.json`：9 个样本的原始进程累计 CPU、时间、帧数、draw call、三角形、快照、拦截计数、窗口 bounds
- `matrix.log`：逐样本控制台输出
- `pixeldiff.json` / `inventory.json`：像素差结果与 71 个 mesh 的名称和面数
- `probes/`：本轮全部脚本。均为运行时 CDP 操作，**未修改仓库源码**；`install.mjs` 注入 `window.__abProbe`，`restore.mjs` 移除它、解除窗口拦截并 detach debugger

## 边界

- 本机、当前尺寸／DPR／形态、清醒固定站立的 CPU 诊断，不是多设备性能声明或功耗测量。
- 与 A1 的条件**不完全相同**：A1 用重建的诊断 renderer 调用 `behaviours.dispose()` 和 `autonomy.pause()`；本轮无法这样做，只用租约压住运动，自主行为（look/peck/quack）仍可能触发。本轮内部三条件的比较有效；与 A1 绝对数值的比较只作参考（本轮 baseline 14.31/8.51 对 A1 stand 14.66/8.38）。
- `tiny-geom` 只有 2 个有效样本。
- 未覆盖自由漫游、拖拽、摔倒恢复、其它形态、开发者窗口。
- 结论是「几何量不是当前配置下的成本项」，**不是**「渲染不是成本项」——A1 已证明停止 rAF 后 GPU 进程 CPU 归零。

## 下一步（推断，未测）

绘制成本既然与内容无关，就应与**帧数**成正比。按 A1 的数据，30 帧/秒的绘制带为 3.82（renderer）+ 6.20（GPU 进程）= 10.02 个百分点，折合每帧每秒约 0.33。若线性，降到 15 fps 约省 5 个百分点、占总量 23 的 22%。这是推断，需要按帧率做对照实测；同时降帧会改变观感，属产品取舍。
