# Reachy Mini 桌面宠物与实体同步

## 使用

1. 托盘或右键菜单 → **机器人 → Reachy Mini**。Microduck 可以随时切回。
2. **连接实体 Reachy Mini** 默认开启；仅选用 Reachy Mini 时运行局域网发现。
3. 设置 → 常规 → 机器人中，地址留空使用 mDNS `_reachy-mini._tcp`，并尝试
   `reachy-mini.local:8000` 与 `localhost:8000`。若设备不广播 mDNS，填写
   `主机名:端口` 或 `http://IP:8000`。Wireless 使用机载 daemon；Lite 使用连接它的电脑上的 daemon。
4. 设置 → 声音 → **机器人声音** 控制当前输出端音量；托盘的 **静音** 同时适用于实体和虚拟形象。

不需要安装 Python SDK、配置云端账号或下载模型权重。3D 模型与 Draco 解码器随应用离线打包。

## 同步与声音（2026-09-06 异味事件后修订，未实机验收）

**当前设备已断电，桌宠进程已停止。整改仅通过离线测试，未安装或重启；不得据此重新上电复测，需先完成硬件检查。**

- 无实体时保留虚拟状态动画；连接实体后只镜像实体回传姿态，不再从渲染循环发送物理 Idle/Agent 表情。
- 主进程状态机提交 `sleeping` / 清醒等高层语义后，直接交给 Reachy 策略；实体控制不经过动画文件名、WebGL 初始化或 renderer 回传。renderer 关闭、崩溃或重载不会触发或重放实体动作。
- 右键唤醒调用官方 `/api/move/play/wake_up`，先按需要启用电机。抬头、官方声音、侧倾与回正由 daemon 完成，结束后核验姿态和电机状态。
- 是否需要唤醒由 `needsWake(snapshot)` 一处判定，客户端护栏、语义生命周期和右键菜单共用它：
  未连接不唤醒；电机关闭、本应用记录的休眠、或实测头部 Z < -30 mm 都需要唤醒。
  只看“电机已启用且不是本应用休眠”会漏掉一种实测情况：启用力矩落地但唤醒动作从未下发时，
  机器人带电停在收起的休眠位姿（实测 Z≈-46 mm），两处护栏都会静默拒绝唤醒。
  改为读实测位姿后这种机器人只发一次 `wake_up`，不会重复启用电机；
  daemon 自己在指令目标已是初始位姿时仍会空转 `wake_up`，属预期。没有姿态反馈时不动。
- 唤醒前会有上限的等待音量写入落地（`Promise.race([setVolume, 1.5 秒])`），因为 daemon 在启用力矩后
  立刻播自带的 `wake_up.wav`；音量还没写进去时该声音会用机器人上一次的音量播放（实测表现为静音）。
  休眠与实体表情不等待，仍是即发即忘，保证 `volume verification is best effort` 的行为不变。
- 超时按物理代价分级：常规读取 2 秒，声音上传 15 秒，启用电机与官方动作 10 秒。
  超时后一律不重发同一物理请求，只重新读取机器人状态判定实际结果：
  `/api/motors/set_mode/enabled` 超时后读 `/api/motors/status`，仍为 enabled 则继续唤醒，否则报错并停止；
  `/api/move/play/*` 超时后读 `/api/move/running`，daemon 仍在动就照常等待并核验到位，没有动作才判定失败。
  错误信息带上方法与路径（例如 `POST /api/motors/set_mode/enabled timed out after 10 s`），便于定位是哪一步放弃的。
- 休眠调用官方 `/api/move/play/goto_sleep`，由 daemon 收头、播放声音并关闭电机；核验 disabled，失败不伪报完成，也不强行在未知姿态直接卸力。
- 因本应用休眠而关闭电机后，后续清醒状态可串行唤醒；连接时已关闭的电机仍须显式唤醒。重复相同休眠状态不重复执行，断开/切换会废弃未执行的旧动作。
- 初次连接会同步当前休眠目标，但不会重放过去的通知/错误提示；外部关闭的电机不会因普通 Agent 状态自动启用。右键显式唤醒与自动生命周期共用一个串行队列。
- 生命周期动作采用官方完整接口，不复刻 Python 插值和 0.2 秒侧头动作。原自编轨迹仅保留给离线虚拟形象。
- 连接成功时先读一次机器人自身音量（`/api/volume/current`）并记住；关闭连接或切走机器人时尽力回写该值，
  瞬时断线重连不回写、也不把我们写入的音量误当成机器人原值。音量同步始终是尽力而为，不阻塞也不取消生命周期动作。
- 音量通过 SDK `set_volume` 命令写入，并由 `/api/volume/current` 核验。写入前先把应用的线性音量（HTMLAudio 增益）映射到机器人的 dB 线性刻度：Reachy Mini Audio 的 `PCM Playback Volume` 是 60 档、−60…0 dB（`amixer cget` 实测），直接写 40 % 相当于 −36 dB、几乎听不见（2026-09-06 首次实机“无声”的真实原因）；映射为 `100 × (1 + 20·log10(v)/60)`，即 1→100、0.4→87、0.1→67、0→0（`robotVolumePercent`）；避免 REST `/volume/set` 自带试音。官方动作声音由实体播放，不再叠加桌面音效；唤醒期间到达的瞬时提示音会丢弃，避免在动作结束后重放旧提示；其它提示音不二次缩放，使用同一系统音量。该音量是机器人全局设置。
- mDNS 广播常常不带 A 记录、`.local` 又优先解析到 IPv6，因此解析出的 IPv4 候选排在 `.local` 名称之前探测，
  名称仍保留为兜底候选，避免在可达机器人面前先耗满一次名称探测超时。
- 自动生命周期（状态机触发的休眠/唤醒）失败时每个新错误只弹一次对话框；右键唤醒失败由菜单自己提示，不重复弹窗。
- Reachy Mini 没有移动底盘：选中它时桌宠窗口不再自动漫游（`canRoam`），与迷你模式是两回事。
- 自动睡眠阈值仍为约 4 分钟无操作。没有加入更短周期的自动上电/断电策略。
- Microduck 尚无实体适配；未来可复用 snapshot/wakeUp 生命周期接口，不能直接复用 Reachy 的关节参数。

## 实体表情（2026-09-06 新增，未实机验收）

连接实体后，桌宠状态不再只有唤醒/休眠：由 daemon 自带的 recorded move 提供实体表情。
动作轨迹和配套声音全部由 daemon 播放，本应用只决定“放哪一个、什么时候放”，不下发任何位姿目标。
渲染进程不改动：它镜像实体回传姿态，虚拟形象会自动跟着做同一个动作。

- 开关：托盘/右键菜单 → 机器人 → **实体表情**（仅选中 Reachy Mini 时出现），对应 `reachyExpressions`，默认开启。
- 数据集：`pollen-robotics/reachy-mini-emotions-library` 与 `pollen-robotics/reachy-mini-dances-library`。
  数据集名含 `/`，作为单个路径段用 `encodeURIComponent` 编码。

| 语义状态 | 触发方式 | 候选动作（emotions / dances） |
| --- | --- | --- |
| idle | 状态持续期间，每 45–90 秒随机一次 | `attentive1`、`attentive2`、`thoughtful1`、`thoughtful2`、`calming1`、`serenity1` / `side_to_side_sway`、`head_tilt_roll`、`pendulum_swing`、`simple_nod`、`side_glance_flick` |
| thinking | 每 40–70 秒 | `inquiring1`、`inquiring2`、`inquiring3`、`uncertain1`、`incomprehensible2` / `uh_huh_tilt` |
| working | 每 60–90 秒 | `helpful1`、`helpful2` / `yeah_nod`、`chin_lead`、`uh_huh_tilt` |
| notification | 进入状态时一次 | `surprised1` |
| attention | 进入状态时一次 | `enthusiastic1` |
| error | 进入状态时一次 | `oops2` |

sweeping / carrying / juggling / roam / sleeping / waking 与全部 `mini-*` 状态没有实体表情；
`initial`（重启后回填的历史状态）不补播进入表情。

- 每次下发前重新核对全部条件：开关打开、当前机器人是 Reachy Mini、已连接、电机已启用、非休眠、
  没有正在执行的生命周期动作（`motionState` 为空）、休眠目标为 false、距上一个表情结束 ≥8 秒、距（重新）连接 ≥5 秒。
  静音（`duckMuted`）不阻止动作：机器人音量此时已同步为 0，声音由 daemon 按该音量播放。
- 表情走与唤醒/休眠同一条 `movePending` 串行队列，因此永远不会与生命周期动作重叠；
  排在表情后面的休眠会等表情结束再执行（表情都很短）。休眠目标为 true 时不再启动新表情。
- 复用 `runNativeMove`：POST 超时 10 秒，超时后只复读 `/api/move/running`、绝不重发，
  最长等待 20 秒完成；表情不做姿态或电机核验，`motionState` 期间为 `expression:<动作名>`，
  因此提示音独占（`lifecycleOwnsAudio`）与渲染进程的 busy 行为与生命周期动作一致。
- 每次连接对每个数据集调用一次 `GET /api/move/recorded-move-datasets/list/{dataset}`（10 秒超时），
  只保留机器人实际列出的动作名；某个数据集列举失败即在本次连接内停用该数据集，不报错、不弹窗。
  结果按连接代际缓存，断线清空。
- 定时器是主进程 `setTimeout`（`unref`），每次状态变化重排，断开、切换机器人、关闭开关、
  进入休眠目标与 dispose 时清除。

## 实现入口

- `src/robots/reachy/reachy-mini-client.js`：mDNS、HTTP 探测、WebSocket 姿态反馈、单实体连接与音频上传/播放，
  以及共用的 `needsWake()` 与 `playRecordedMove()` / `listRecordedMoves()`。
- `src/robots/reachy/reachy-expressions.js`：实体表情的映射表、准入条件、定时与数据集可用性缓存。
- `src/state/state.js` / `src/robots/reachy/reachy-mini-main.js`：高层语义分发、实体生命周期策略、音量与输出端选择。
- `renderer/src/runtime/reachy-runtime.js` / `reachy-motion.js`：离线虚拟动作与实体反馈的只读 3D 投射。
- `renderer/src/runtime/reachy-rig.js`：官方 GLB 的骨骼校准、头部位姿转换和 Stewart 颈部逆运动学。
- `renderer/src/adapters/reachy-audio.js`：只执行主进程选择的电脑提示音；实体连接时停止电脑声音。

接口依据官方 SDK commit `234a978e4426895fc88d864e7f154643aea77f53`，音频 HTTP 端点也核对了 `v1.9.0`。
模型与骨骼校准来源见根目录 `NOTICE.md`。不读取摄像头、麦克风或其它应用会话。

## 验证记录（2026-09-06）

- `node --test test/reachy-mini.test.js test/reachy-main.test.js test/robot-power-control.test.js test/state.test.js`：本机 HTTP/WebSocket 测试服务器与纯离线替身验证握手、姿态反馈、语义分发、renderer 故障隔离、重载去重、连接代际、实体音频独占、静音取消与共享音量。
- 浏览器预览：`npm run dev:renderer`，打开 `http://127.0.0.1:5176/?robot=reachy-mini`。
  可附加 `&state=duck-thinking`、`duck-error` 等查看动作。已检查 240×240 显示，模型和两根天线完整，无 WebGL 错误。
- 当次局域网 mDNS 与默认地址没有发现实体；历史地址 `192.168.31.82:8000` 连接超时。
  **实体动作同步、真实扬声器与断电恢复尚未实机验收。** 本地 arm64 应用已更新重启。

实机验收：切到 Reachy Mini，确认 daemon 电机已启用，依次触发 idle/thinking/notification/error/sleeping/waking；
观察实体与虚拟形象一致且仅实体出声，再调音量、静音、断网检查电脑恢复播放，最后切回 Microduck 检查实体停止接收新目标。

- 2026-09-06 休眠修正：SDK 完整休眠位姿与触角角度、约 1 秒回正 + 2 秒下沉、2 秒唤醒；物理发送按 25 Hz 实际间隔限速，并允许从已休眠反馈姿态渐进唤醒。保留电机关闭时仅镜像的行为，不调用会绕过共享音量播放声音的 SDK 整体动作。动作测试覆盖离线、在线反馈和中途唤醒。

- 2026-09-06 实机反馈修正：实际收头 Z≈-48 mm、头旋转≈33°、机身偏转≈20°，左触角在 -π 分支且 FK 矩阵含约 0.0005 精度误差。加入该实测回归样本，容纳校准偏差、统一触角分支、输出旋转归一化，保留逐步位移/转角限速。音效改为官方 SDK 原始 PCM（wake_up/go_sleep/impatient1/confused1），按真实音频时长跟踪播放与静音。

- 同日实机续验：仅从反馈位置重复小步会受伺服死区影响停滞。右键使用官方 move/goto 定时抬头并核验实测位置，动作期间暂停桌宠目标流；常规目标允许累积但限制与实测位置的距离。实机 Z 从约 -47 mm 升到约 -4 mm；专项测试 20 项通过（含实测姿态、控制死区、未到位失败）。

- 2026-09-06 控制链清理：删除 renderer 侧的物理目标通路（`sendPose` / `validPose` 及 `step()` 的反馈入参），
  实体只执行官方动作，上面两条“实机反馈修正 / 实机续验”里的自编轨迹发送已不再存在，仅作历史保留。
  25 Hz 限速改由主进程的状态推送承担，并会补发一次被丢弃的最新状态，避免动作结束后界面停在旧帧。
  `pet-runtime-config` 移回主进程通用桌宠布线，切走 Reachy 释放适配器时不会连带注销它；renderer 读取失败则回落到启动快照。

- 2026-09-06 实机唤醒超时（右键“唤醒”报 `The operation was aborted due to timeout`，电机仍 disabled，WebSocket 掉线重连）：
  原因是启用力矩耗时超过 2 秒默认超时，动作因此从未下发。已按上面的分级超时与超时后复读规则修正，
  不重发任何物理请求。离线替身测试覆盖四种情况：启用超时但状态为 enabled 则继续唤醒；状态仍 disabled 则报带请求名的错误且不二次 POST；
  动作超时但 daemon 仍在动则继续等待并核验到位；没有动作则失败且不二次 POST。**本次修正同样未实机复测。**

- 2026-09-06 唤醒判定与实体表情：改为按实测位姿判定是否需要唤醒（修复带电停在收起位姿被静默拒绝唤醒），
  唤醒前有上限地等待音量写入，并新增基于 daemon recorded move 的实体表情与 `reachyExpressions` 开关。
  验证仍为纯离线：`node --test test/reachy-mini.test.js test/reachy-main.test.js test/robot-power-control.test.js test/reachy-expressions.test.js`
  共 60 项通过（含 `needsWake` 单元用例、带电折叠机器人只发一次 `wake_up`、音量等待上限、
  表情的 URL 编码与串行化、超时不重发、数据集过滤与列举失败降级），`npm test` 5802 项通过。
  **本次修正未实机复测；表情映射的动作名取自实机列举记录，未在设备上回放。**

完整离线对照与事件边界见 `reachy-control-audit-2026-09-06.md`。历史实机抬头成功不代表热安全或持续运动通过验收。

## 实机端到端验证记录（2026-09-06，新机，daemon 1.10.0）

同一套流程先在本地假 daemon（`scripts/reachy-dev/fake-reachy-daemon.cjs`，实现 1.10.0 的状态/电机/动作/音量/上传接口并记录每次调用；驱动方式见 `scripts/reachy-dev/README.md`）上跑通，再在真机复跑，结果一致：

| 阶段 | 触发 | 机器人侧（journal / 反馈） |
| --- | --- | --- |
| 连接 | 自动连接 | 读原音量→写 87 %（0.4 的 dB 映射）并核验；列出 emotions/dances 动作库 |
| 右键唤醒 | `robotPowerControl.wake()` | `set_mode/enabled` → `wake_up` → daemon 自播 wake_up.wav → 头 z −2 mm、触角开 |
| notification | 语义状态 | `surprised1` 录制动作（自带官方音效），不再叠加桌面提示音 |
| 会话结束 | 语义 sleeping | `goto_sleep` → daemon 自播 go_sleep.wav → 电机 disabled、头 z −45 mm，应用 `sleeping=true` 保持 |
| 会话恢复 | 语义 working | 自动唤醒：`set_mode/enabled` → `wake_up` → 唤醒音 |
| 关闭实体表情后的 notification | 语义状态 | 上传官方 impatient1.wav（159 406 B）→ `play_sound` |

两处在此过程中发现并修复：①50 Hz 位姿帧曾用连接时的电机模式覆盖休眠后 REST 核验到的 `disabled`，让刚被我们休眠的机器人在下一条 `daemon_status` 到来前看起来是醒的，右键唤醒因此跳过上电；现在电机模式只来自 daemon 状态消息和生命周期后的 REST 核验。②进入型表情（surprised1/oops2/enthusiastic1）自带官方音效，触发时显式跳过桌面提示音，而不是靠竞态碰巧跳过；关闭“实体表情”后提示音恢复。

**2026-09-06 动作库筛选（第一版白名单）**：30 个候选按 journal 重建的时长/音效/IK 告警筛选。剔除 `curious1`（快速侧转碰壳）、`understanding1`（15 次 IK 碰撞告警）、`yes1`（3 次）、`understanding2`（此前 2 次）、`waiting`/`boredom1`/`boredom2`（11–17 s 过长）。舞蹈库动作 2–3 s 无声，情绪库 3–8 s 自带音效。compact（sweeping）单独用 `tired1`（"你打个哈欠，通常在两个任务之间、尤其是努力工作之后"，7.4 s）作为进入型表情，不再放进 idle 轮换。颈部扭转峰值因筛选中途电机失去力矩而未能记录，待重跑。

**力矩丢失防御**：筛选进行中所有电机曾在 daemon 仍报 `enabled`、无硬件错误标志的情况下失去力矩（journal 仅有一条 `Serial I/O recovered after 4 retries`），头塌到折叠姿态、后续动作只剩声音。此后显式唤醒若发现头部折叠而 daemon 报 enabled，先 `set_mode/disabled` 再 `set_mode/enabled`（daemon 上电前把目标钉在当前位姿，不会跳变）再 `wake_up`。

## 实体常态动作（liveliness，2026-09-06）

`src/robots/reachy/reachy-liveliness.js`。机器人醒着且桌宠处于 idle / roam / thinking / working / juggling 时，主进程以 60 Hz（官方对话应用的节拍）通过 SDK 套接字发送 `set_full_target`，渲染层仍只镜像回传位姿。两层叠加：

- **呼吸**：z 正弦 + 触角反向摆动，参数取自官方 `reachy_mini_conversation_app/moves.py` 的 `BreathingMove`（5 mm @0.1 Hz、±15° @0.5 Hz）。
- **扫视—停住**：头部用 smoothstep 移到一个新朝向后停住，一次只做一个明确的动作。多个小幅正弦叠加会让六个头部伺服频繁互相反向、链杆间隙来回被吃掉而发抖，这一版就是为此改的。

| 状态 | 呼吸 z / 触角 | 偏航（总量，世界系） | 颈部最大扭转 | 俯仰（负为低头） | 翻滚 | 单次移动 | 停住 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle / roam | 5 mm @0.10 Hz / ±15° @0.5 Hz | ±15° | 6° | ±5° | ±3° | 0.9–1.4 s | 2.5–6 s |
| thinking | 4 mm @0.14 Hz / ±12° @0.6 Hz | ±8° | 4° | +2…+9°（抬头） | ±12°（歪头） | 0.9–1.3 s | 1.8–4 s |
| working / juggling | 5 mm @0.25 Hz / ±12° @0.8 Hz | ±20° | 5° | −14…−2°（低头看活） | ±6° | 0.35–0.55 s | 0.7–2.2 s |

**身体同步转动（2026-09-06 用户反馈低头时颈部扭 14° 会撞到身体壳）**：目标偏航与当前身体朝向相差不超过 `neck` 的扫视只动颈部；更宽的扫视整段由身体承担、颈部回正，这样下一次扫视又能先动头（`body_yaw` 随头部消息一起发送；头部矩阵是世界系位姿，daemon 的 IK 用 `body_yaw` 算出颈部相对角 = 总偏航 − 身体偏航，代码里恒有 `yaw = body + clamp(want − body, ±neck)`）。带身体转动的扫视按每度 10 % 拉长移动时间，避免身体电机急转。身体比头晚 150 ms 起步（`BODY_LAG_MS`）：头先转到颈部限幅处等着，身体跟上后头再到位，先后分明但相对角始终不超限。daemon 的解析 IK 默认 `automatic_body_yaw`，只在相对角超过 65° 时才自行改动身体角，我们的角度远在其内。真机（working，14 s）：头部偏航 −11…+10°、身体 −5…+5°、颈部相对扭转最大 6.2°、俯仰 −14…−6°，无 IK / 丢弃告警。

**发送死区（抖动的真正来源）**：实测 daemon 每收到一条带 `head` 的目标就重新解 IK 并重写六个伺服目标，哪怕目标完全没变，头部也会出现最大约 0.7° 的抽动（同一位姿以 60 Hz 或 2 Hz 反复发送都如此；完全不发时静止噪声仅 0.19°；以关节量 `set_head_joints` 反复发送则接近静止）。因此目标只在位移 ≥0.4 mm 或角度 ≥0.15°（daemon 自己的 IK 容差量级）时才发，停住期间完全不发；头部与触角分开判定并分别进消息，不带 `head` 的消息不会触发 IK，触角摆动不再牵连头部。`SEND_DEADBAND` 是调节旋钮：加大 z 死区可进一步减少呼吸期间的发送次数，代价是呼吸变成更明显的台阶。

准入与暂停：断线、电机未上电、休眠、期望休眠、任何生命周期动作或表情进行中（`motionState`）、未映射状态、“实体动作”开关关闭、非 Reachy 机器人时不发送；恢复与切换状态都从当前实测/当前插值朝向重新出发，不跳变。矩阵约定与 daemon 的 `create_head_pose` 一致（外旋 x-y-z，即 R = Rz·Ry·Rx）。菜单开关 `reachyExpressions` 同时控制表情与常态动作。

真机验证（2026-09-06 20:40，working）：头部消息 16.8 条/s、触角 42.6 条/s（原 60 条/s 整包）；停住窗口内偏航逐帧变化最大 0.23°、俯仰 0.15°、z 0.08 mm，与不发目标时的静止噪声相同；移动窗口内偏航最大 1.46°/帧即约 120°/s 的扫视；控制环 49.6 Hz、0 错误，无丢弃/IK 告警。
