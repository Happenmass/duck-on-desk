# Duck on Desk A1 性能归因（2026-09-08）

## 结论

本次同实例、同资源、固定清醒状态的重复实测推翻了“限帧后渲染不再是瓶颈／GPU 进程存在约 8% 固定合成地板”的旧推断。停止 rAF 后，GPU 进程的 CPU 占用接近零，renderer 的 CPU 占用约减半。旧冻结实验与本轮结果冲突，其测量脚本未完整保留，本次不臆断旧实验的具体失效原因。

A2 不是当前站立／原地工作步态的优先优化：40 ms 位移定时器每分钟触发约 1500 次，但这些状态的实际位移 IPC 为零。A3 中输入 Tensor 构造也不是主要热点；输出缓冲复用未做收益或兼容性验证，不能从输入构造计时推断其收益。下一轮应优先在渲染路径做小步对照测量；本次不实施 A2/A3、不修改外观或物理行为、不搭建阶段 B。

## 条件与方法

- 工作区 HEAD：`3f64edf5700f681cc5180e5939510f574f737f76`；原工作区干净。运行实例：v0.2.2，Electron 41.10.4 / Chromium 146.0.7680.216，Apple M3 Max，14 个逻辑 CPU，120 Hz 内屏。
- 宠物窗 156×156 CSS px，devicePixelRatio 2，透明置顶；Duck classic、legs、无高跷、清醒 walk 模式；shadows=false。实测每帧 71 draw calls、198452 triangles（当前值替代旧几何统计）。
- 原包入口 bundle `index-W_bWmYfZ.js` SHA256 与工作区一致，详见 `environment.json`。136 个模型／公开静态资源逐文件哈希一致，详见 `asset-verification.json`。策略仍由原 App 的 `pet-model://` 协议加载全局缓存。
- 未启动或重启主进程、未连接／驱动 Reachy。先核验现选宠物为 Duck，再仅将宠物 renderer 临时加载为 `/tmp` 中的诊断构建；不改设置和安装包。
- 先在原 renderer 上做 30 秒 CDP CPU Profiler + 进程基线（此段有 profiler 开销，且未固定行为，不混入下面统计）。矩阵段不启用采样 profiler，只使用轻量计时与计数。
- 固定 `stand`：reset 后 local move forward=0、heading=0；固定 `walk`：forward=0.6、heading=0；租约持续覆盖测量。暂停随机自主动作，忽略临时 renderer 收到的行为／眼动切换。这里的 walk 是原地工作步态，**不是自由漫游移窗**。
- 每个样本预热 8 秒、取样 60 秒；正常／停 rAF 每状态各 3 次，轮换顺序。停止 rAF 是取消 runtime 所持有的实际 requestAnimationFrame ID，并保持控制循环运行；恢复时重新启动同一渲染循环。
- 每段用实际控制步数／绘制帧数校验 50 Hz／30 fps；停 rAF 样本帧数为 0，段前段后 `capturePage().toPNG()` SHA256 相同。截图操作放在 CPU 采样窗口外。
- CPU = `100 × Δapp.getAppMetrics().cpu.cumulativeCPUUsage / Δ墙钟秒`，100% 表示占满一个 CPU 核，不是整机归一化比例，**GPU 行也是该进程的 CPU 占用，并非 GPU 利用率**。
- 主进程分别计数位移 IPC 接收、现有三个 BrowserWindow 的 setBounds/setPosition 调用、调用前后整像素坐标变化。renderer 计数定时器触发、具备发送条件、实际发送。
- 站立首轮还做“仅停位移上报”和“两者都停”各一次；因 IPC 原本为零，后续不重复这些空操作。收尾按窗口计数校验发现 3 段非 IPC 引起的窗口移动，已从有效结果剔除并保留在 excluded-samples.json；受影响的正常站立／停 rAF 行走各补测一次，“两者都停”的冗余样本不补测。未追踪那 3 段移动的调用栈，不臆断其来源。中途终止的一段行走预备样本未进入结果文件。

## 进程 CPU 结果

数值为均值（最小–最大），单位为单核百分比。

| 状态 | 条件 | n | renderer CPU | GPU 进程 CPU | 主进程 CPU |
|---|---|---:|---:|---:|---:|
| stand | normal | 3 | 14.66 (14.60–14.71) | 8.38 (8.26–8.47) | 0.64 (0.51–0.74) |
| stand | no-raf | 3 | 6.83 (6.30–7.12) | 0.01 (0.01–0.01) | 0.65 (0.42–0.89) |
| stand | no-displacement | 1 | 13.64 (13.64–13.64) | 7.78 (7.78–7.78) | 0.57 (0.57–0.57) |
| walk | normal | 3 | 14.06 (13.93–14.14) | 8.19 (8.10–8.29) | 0.50 (0.47–0.55) |
| walk | no-raf | 3 | 6.75 (6.48–7.11) | 0.01 (0.01–0.01) | 0.67 (0.48–0.77) |

所有完成矩阵样本均通过条件校验；位移 IPC 和所监控窗口移动调用均为零。该结论只覆盖上述固定状态，不能推断自由漫游时不存在 IPC 或移窗成本。

## 控制回路拆分

下表合并正常渲染的站立／行走样本。“P50 范围”“P95 范围”表示各独立样本分位数的范围，**不是合并分布的分位数**。时间单位 ms。

| 区段 | 每次均值 | P50 范围 | P95 范围 | 累积墙钟 / 采样窗口 |
|---|---:|---:|---:|---:|
| observation | 0.0606 | 0.10–0.10 | 0.10–0.20 | 0.303% |
| tensor | 0.0036 | 0.00–0.00 | 0.00–0.10 | 0.018% |
| sessionRunWall | 0.2263 | 0.20–0.20 | 0.30–0.40 | 1.132% |
| actionAndSelection | 0.0081 | 0.00–0.00 | 0.10–0.10 | 0.041% |
| physicsStep | 0.4487 | 0.40–0.50 | 0.70–0.80 | 2.244% |
| recenter | 0.0876 | 0.10–0.10 | 0.20–0.20 | 0.438% |
| soundAndRecovery | 0.0270 | 0.00–0.00 | 0.10–0.10 | 0.135% |
| controlTotalWall | 0.8695 | 0.80–0.90 | 1.20–1.40 | 4.348% |

- `sessionRunWall` 包含 await 等待，`controlTotalWall` 也包含它，不能直接视为 CPU 核占用；总项包含其子项，不可相加。
- `physicsStep` 是每控制周期的全部 MuJoCo substeps；`recenter` 包含 mj_forward；`soundAndRecovery` 包含脚步、动作推进、恢复检测；`actionAndSelection` 实际计时覆盖输出读取与 ctrl 写入，session 选择等微小开销只落在总项。
- performance.now 实际约 0.1 ms 分辨率，微小段 P50=0 不表示零成本；用累计值解释 Tensor 等短操作。探针计时调用及统计有开销，未声称这些数值是无探针的纳秒精度成本。
- App 确认使用 onnxruntime-web/wasm、numThreads=1；后端一致不等于整个 workload 一致。裸测 1.1% 没有与本次固定状态、调度频率、CPU 睡眠／升频行为完成匹配，不能把差额全部归为 Tensor 封送或 Electron 包装。

## 证据和复查

- `matrix.json`：每轮原始进程累计 CPU、时间、快照、计时分位数、计数和截图哈希。
- `original-renderer.cpuprofile` / `original-baseline.json`：未改 renderer 的 30 秒采样与上下文，可在 DevTools 导入 CPU profile；它仅覆盖 V8 采样，不能代表 renderer 全线程 CPU。
- `temporary-probes.patch`：只用于本次临时 renderer 的源代码差异，**未应用到正式 runtime**。可用 `git apply --check docs/diagnostics/a1-2026-09-08/temporary-probes.patch` 审查是否仍匹配代码基线。
- macOS 原生 sample 的符号不完整，不据其近似符号名下热点结论；原始现场文件保留在 `/tmp/duck-a1-20260908/`，没有作为最终归因依据。

## 边界

这是本机、当前尺寸／DPR／形态、清醒固定站立和原地工作步态的 CPU 诊断，不是多设备性能声明或实际功耗测量。未覆盖自由漫游、拖拽、摔倒恢复、其他形态、开发者窗口。后续渲染改动须重新验证观感与手感；不因本次结果直接填 HIDDEN_MESHES 或删掉 MuJoCo。

## 补充隔离（探索性，单次 30 秒）

- `no-draw`：renderer 10.842%，GPU 进程 2.176%；计数 `{"controlSteps": 1500, "renderFrames": 900, "skippedDraws": 900, "displacementTicks": 750}`。
- `no-control-no-raf`：renderer 2.056%，GPU 进程 0.005%；计数 `{"displacementTicks": 750}`。

`no-draw` 保留 rAF 与场景准备，只将 WebGLRenderer.render 临时替换为计数空操作；`no-control-no-raf` 暂停控制和 rAF，40 ms 桥定时器仍工作。此两段只作归因补充，不与三次重复数据混合。详见 `followup.json`。


## 收尾与下一步

- 最终有效矩阵为 13 段：12 段正常／停 rAF 的重复对照（2 状态 × 2 条件 × 3 次），加 1 段仅停位移上报。另有 3 段发生窗口移动的排除样本，详见 `excluded-samples.json`；原先的 valid 标志只校验控制／绘制，收尾已加入窗口计数稳定性校验。
- 10.0086 秒内实际 1200 次 rAF 回调、300 次绘制（`raf-cadence.json`），即当前“30 fps”限的是绘制，rAF 仍随 120 Hz 显示器唤醒。结合 no-draw 的残余开销，下一步优先做“按目标 30 Hz 安排 rAF”的对照原型；收益仍需实测，不能把停 rAF 的全部差值当作可实现收益。
- 单次控制暂停补充实验中 renderer 降到约 2.06%，GPU 进程约 0.005%；40 ms 桥定时器仍触发 750 次。停 rAF 后的 renderer 残余应进一步区分控制循环相关工作与基础定时器／Chromium 活动，不能全归为策略数学计算。
- A2 暂缓用于本轮静态窗口性能优化；不否定其在自由漫游中的潜在收益。A3 输入 Tensor 复用优先级低，输出预分配未验证。MuJoCo、外观、阶段 B 均未改动。
- 补测后再次恢复原包 renderer，主进程仍为 PID 79931；复核 ready=true、ctrlHz=50、fps=30、motionSource=system，临时全局探针消失，CDP debugger 已 detach，位移 IPC 监听器恢复为原来 1 个。Node inspector 随后关闭。详见 `restoration.json`。
- 正式代码及安装包未修改，未提交或发布；本次仅新增本目录诊断报告、原始结果与探针差异。探针 patch 的 `git apply --check` 通过；没有为纯诊断文档运行全量应用测试。
