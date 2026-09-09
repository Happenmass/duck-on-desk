# Duck Robot Lab MCP

已提供独立 3D 机器人实验室、奖励／策略网络编辑、真实 MuJoCo＋PPO 训练、ONNX 导出、双后端评测、桌宠策略应用与回退。在「设置 → 关于」打开开发者模式即可进入实验室；Agent 管理页可以给 Claude Code、Codex CLI、OpenCode 安装同一套 MCP。

## 从 Agent 管理页安装

在「Agent 管理」展开 Claude Code、Codex CLI 或 OpenCode，找到「Robot Lab MCP」，点击「安装 MCP」。也可更新配置、刷新状态或移除。Pi 当前没有原生 MCP 配置入口，页面会提示需要扩展。

安装前会实际启动 MCP 并核对工具列表，然后仅写入用户级的 `duck-robot-lab` 项：Claude Code 的 `.claude.json`、Codex 的 `config.toml`（使用官方 CLI）、OpenCode 的全局 JSON/JSONC 配置。保留其他服务、注释和 hooks；同名非 Duck 管理配置会拒绝覆盖。`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`XDG_CONFIG_HOME` 按 Duck 进程环境解析。本入口只配置本机，不修改 WSL 或远端机器。

Python 可填写已有 PyTorch 环境的可执行文件绝对路径。留空使用 `python3`，仍可查询文档和保存草稿；运行设备测试还需要 Python＋PyTorch。MCP 安装不自动下载 Python、PyTorch 或模型。

配置后重新打开 Agent 会话加载；项目级配置可能覆盖用户级条目。「已配置」表示配置已写入并回读，不代表当前会话已连接。Codex CLI 与 Node.js 22.12+ 需在本机可用；GUI 找不到 CLI 时需修正 PATH 后重开 Duck。

构建时 MCP 脚本与 npm 依赖分别复制到 `Resources/robot-lab-mcp/`，由系统 Node 启动。根目录 `npm ci` 会在 postinstall 安装 MCP 依赖；不会运行第三方安装脚本。

## 手动启动

```sh
npm ci --prefix mcp/robot-lab
DUCK_LAB_PYTHON=/absolute/path/to/python npm --prefix mcp/robot-lab start
```

需要 Node >=22.12，以及安装 PyTorch 的 Python。直接复用已有虚拟环境，不会自动安装 PyTorch、下载模型或提交云任务。MCP 客户端配置示例（把绝对路径换成本机路径）：

```json
{
  "mcpServers": {
    "duck-robot-lab": {
      "command": "node",
      "args": ["/absolute/path/to/duck-on-desk/mcp/robot-lab/server.mjs"],
      "env": { "DUCK_LAB_PYTHON": "/absolute/path/to/python" }
    }
  }
}
```

每个客户端启动 stdio 服务。`DUCK_LAB_HOME` 可覆盖实验目录，默认 `~/.duck-on-desk/robot-lab`。服务不启动 App，不改变现有桌宠模型。也可以使用上述管理页注册；修改源代码或构建安装包本身不会自动改用户的 Agent 配置。

## 接口

| 工具 | 用途 |
|---|---|
| lab_docs_search / lab_docs_read | 搜索、分页读取接口与后端文档 |
| lab_backends_inspect | 查询真实 PyTorch CPU／MPS／CUDA 可用性 |
| lab_experiment_create / lab_experiment_read | 创建实验草稿、读取版本与脚本 |
| lab_experiment_write | 写 reward.py、strategy.py、training.json，校验 expected_revision |
| lab_experiment_validate | 配置、Python 语法与函数签名检查，不执行脚本 |
| lab_backend_probe | 显式执行指定版本，在指定设备做 3 次合成梯度更新和推理 |
| lab_training_defaults / start / resume / list / get / cancel | 真实 PPO 模板、启动、进度与取消 |
| lab_policy_artifact | 核验并返回 ONNX／检查点／元数据路径 |

资源：`lab://docs/overview`、`lab://docs/scripts`、`lab://docs/backends`。

写入只保存草稿，冲突返回 `REVISION_CONFLICT`。执行也要求预期版本，结果附脚本 SHA-256。最多保留十次历史快照；异常退出遗留 `.lock` 时，确认没有写入进程后人工清理该锁文件。

脚本运行在具有本地用户权限的 Python 子进程中，**不是沙箱**。仅运行可信项目脚本；45 秒超时会终止 worker，但不保证终止脚本自行创建的子进程。语法校验也不是安全审计。当前不提供任意文件写入或 shell 工具。

## 首轮验证

```sh
DUCK_LAB_PYTHON=/absolute/path/to/python npm --prefix mcp/robot-lab test
```

`first-round.mjs` 使用官方 MCP SDK 客户端，通过 stdio 完成 initialize、tools/list、resources/list、resources/read 和 tools/call。测试覆盖文档查询、三类草稿写入、旧版本拒绝、非法 ID、错误配置／语法／奖励形状，以及所有本机可用设备的实际参数更新和推理；不可用设备须报错，不静默退回 CPU。可用 `DUCK_LAB_REPORT=/absolute/path/report.json` 保存证据，临时实验记录会清理。

2026-09-08 本机 PyTorch 2.9.1：CPU／MPS 探针通过；CUDA 待实机验证。详见 [首轮报告](../../docs/diagnostics/robot-lab-mcp-2026-09-08/README.md)。合成观测的 61／14 维仅验证接口形状，`robot_environment_steps=0`；不代表 PPO 训练、走路能力或导回成功。

## 真实训练与实验室

从「设置 → 关于 → 打开开发者模式」进入；开关保存后，关闭窗口仍可从同页再次打开。窗口不透明、可缩放、不置顶；关闭后销毁 3D 实例，已启动的训练继续，退出其所属 App 或 MCP 进程会停止任务。开发时可独立运行 `npm run dev:lab`，只启动虚拟实验室，不启动桌宠或实体适配器。

选用已安装 torch、mujoco、onnx、onnxruntime 的 Python 环境；两课共用同一网络结构，行走默认加载官方权重，倒立保持默认随机起步，也可切换作对照；结构固定为 61→512→256→128→14 / ELU。可编辑物理奖励、设置训练参数、暂停／单步仿真、旋转相机、手动控制 14 个关节。训练后先在实验室预览及评测，再应用或导出；可恢复上一策略。检查点保留 actor、critic、optimizer；实验室和 MCP 均可接着检查点追加训练，其他 RL 算法尚未接入。

Agent 创建 `mode="robot"` 草稿，经版本化写入和校验后调用 `lab_training_start`；通过 `lab_training_get/list/cancel` 管理任务，`lab_policy_artifact` 读取产物。`lab_training_defaults` 返回真实模板。详细字段、单位、动作契约和准入门槛见 [脚本文档](docs/scripts.md)。

```sh
DUCK_LAB_PYTHON=/absolute/path/to/python node mcp/robot-lab/training-round.mjs
```

这项集成测试会通过真实 MCP 写入奖励／策略，执行 20 轮 MPS 训练和推理，核对 2,560 个真实环境步、参数更新、ONNX 数值一致性，并实测取消。产物保存到用户模型缓存，方便在实验室选择同一任务继续评测。2026-09-08 已通过；[实测记录](../../docs/diagnostics/robot-lab-mcp-2026-09-08/real-training.json)。短训通过不退步检查，不代表已学会更好的步态。

MPS／CUDA 负责 Python 模型训练与推理，物理为 CPU MuJoCo；桌宠和实验室预览仍用 Web WASM。CUDA 待 NVIDIA 实机验证，未接入 HF Jobs 或其他付费执行器。

## 默认平地行走参数（2026-09-09 开发版）

以上数值仅为默认值，不限制可调参数上限；新建与续训均不设轮数或两小时时限。新工作台和 MCP 的 `mode=robot` 新实验使用[官方全量微调设置](presets/official-finetune/README.md)：200 轮、32 环境、64 步、lr=.0001、seed=2；设备按平台选择；行走目标 0.25 m/s。行走默认官方原权重与标准化；倒立保持默认随机权重与固定 mean=0／scale=1，所有策略层可训练。续训恢复所选记录，不重新初始化。旧[修正网络参数包](presets/stable-flat-walk/README.md)及其[实测报告](../../docs/diagnostics/training-parameters-2026-09-09/README.md)保留作历史依据，不能把其稳定性结论套用到新的全量微调。

已有工作台继续使用用户保存的配置；`lab_training_defaults` 返回实际生效值。上面的 20 轮集成测试显式使用短测配置，不会随着默认轮数增加而延长。

## 第二课与桌宠动作库（本地 1.1.0）

- Duck 右键「动作」：啄地、行走时随机播放开关、训练／管理入口。只在普通脚态播放这些站立动作；播放前后都先站稳，遇到睡眠、拖拽或状态变化会取消。
- 实验室第二课为「倒立保持」（microduck-headstand-hold）：从环境提供的近头撑姿态开始，先练抗小扰动保持，保留自定义 Reward、曲线和可选 3D。后续再练从站立翻转进入、恢复正立；街舞入口已移除，待完整动作跑通后再做。基础模型只供练习，不加入动作库。
- MCP 现有 15 个工具，create/defaults 支持 task 参数，新增 lab_actions_list；动作的观测相位与评测接口见 [scripts](docs/scripts.md)。
- 历史站立起步倒立实验（microduck-headstand）的 MPS 200／CPU 500／MPS 1,000 轮均未学会稳定倒立；旧街舞实验及其权重保留，可通过 MCP 查询。默认参数仍为探索起点；CUDA 待实机。


### 本机 PPO 新版参数（2026-09-09）

新草稿采用 local-ppo-v2：32×64 样本，5 遍／4 小批 PPO，KL 自适应学习率、价值裁剪、较大 critic 与可学习探索噪声。行走 lr 上限 .0001，倒立保持 .0003；初始化及身体角度奖励维持当前课程要求。旧记录续训原样，旧无 ppo_profile 的 MCP 草稿仍用 legacy-v1。高级参数中点击“使用本机推荐参数”可更新已有表单。短测不等于学会倒立；[核验与对照](../../docs/diagnostics/ppo-parameters-2026-09-09.md)。


第二课新训练允许倾斜／碰地后用脚蹬地恢复，不再提前重置，默认奖励取消脚触地单独扣分。训练跨轮连续运行，默认每30秒模拟时间重置；界面可配置0～1000秒，0关闭定时重置；独立评测仍为8秒，严格倒立保持单独计时。旧记录续训保留旧规则。说明见[实验室指南](../../docs/guides/robot-lab-console.md#2026-09-09允许蹬地恢复)。

### 首次训练环境（1.1.2）

训练页面 Python 路径留空时自动安装独立环境。也可先调用 `lab_environment_setup`，再用 `lab_environment_status` 查询进度。`lab_training_start` 返回的 `preparing` 状态包含 `preparation` 文案，完成准备后自动开始训练；`lab_training_cancel` 可停止准备。Windows x64 默认 CUDA，Apple Silicon 默认 MPS，GPU 不可用时不会退回 CPU。已有自定义 Python 只做检查。详见 [后端说明](docs/backends.md)。
