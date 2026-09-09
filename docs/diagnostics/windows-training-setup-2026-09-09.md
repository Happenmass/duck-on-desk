# Windows 首次训练失败与自动环境安装（2026-09-09）

用户在 NVIDIA Windows 新机器上遇到 `Microduck model / base policy unavailable; install model assets first`。本机使用空用户缓存、真实安装包的 XML 路径复现同一错误；XML 存在。新建服务后再创建模型缓存文件，仍报相同错误。

## 原因

1. `jobs.cjs` 在构造时选定 `basePolicy`。冷缓存时选中已从安装包移除的 `../policies/BEST_alpha_walking.onnx`；之后 renderer 下载完也不重新查找。
2. 模型自动下载仅接到 renderer 的 `pet-model` 协议，训练入口没有准备流程。
3. Windows CI 34354360850 实际冷安装成功，但训练读取中文 JSON 时触发 CP1252 `charmap` 解码错误。训练文件读取改为显式 UTF-8，训练与 MCP 子进程统一 UTF-8；旧开发机 macOS 默认编码没有暴露它。
4. Python 安装功能此前不存在；训练默认 `python3` 且默认设备写死 MPS。开发机已有模型缓存和手动配置的虚拟环境，旧测试没有覆盖新安装场景。

可重复的失败回归命令：`node --test test/robot-lab-cold-start.test.js`。修复前前三项全部失败：两次上述模型错误、Windows 默认设备 mps 与 cuda 的断言不符。

## 修复

- 训练服务每次使用用户缓存中的固定基础策略路径；与 renderer 共享 `policy-cache.js`，包外 MCP 由相同源文件生成，避免两套下载逻辑。
- `start` 先返回 `preparing` 任务，异步安装完成才启动 Python。进度写入任务；准备期间可以停止。两小时训练预算从训练进程启动算起。
- 路径为空时通过校验 SHA-256 的 uv 0.8.22 安装受控 Python 3.12 与固定依赖；独立目录、跨进程安装锁、失败重试。已有自定义 Python 只检查，不 pip 修改。用户级模型缓存仍是唯一权重位置。
- Windows x64 默认 CUDA，Apple Silicon 默认 MPS，启动前实测请求设备的梯度计算，无 CPU 自动降级。CUDA wheel 使用官方 cu128 / torch 2.9.1。Intel Mac / Windows ARM 暂用自定义环境。
- UI 提供自动准备文案、“检查 / 安装训练环境”和可保留的错误信息；MCP 新增 `lab_environment_setup`、`lab_environment_status`，训练准备阶段可轮询与取消。

## 本机验证

- Node 5,876 通过、15 跳过；新增冷缓存、后出现缓存、Windows 默认设备、准备取消、CUDA wheel 命令、缺 XML、下载损坏、安装失败重试、自定义环境不修改等回归。
- 4 个 MCP 协议测试通过，包括安装入口的立即返回、完成状态与后续设备查询；工具数 18。
- 新建托管 MPS 环境：Python 留空，自动安装 → 1 轮 / 8 步 PPO → ONNX 导出，合计 64.072 秒，导出误差 2.05e-8。仅验证安装/计算链路，不代表学会倒立。
- 新建托管 CPU 环境：2 环境 × 8 步，导出误差 2.61e-8。
- 包内 CPU 真实训练 16 步 / 8.013 秒导出；包内 UI 的空路径自动训练、错误自定义 Python → 清空重试通过，18 个 MCP 工具可加载。共享模型下载模块的包外路径已加入回归。CI 双平台结果见 `.release-reviews/windows-training-setup/`；CUDA 实际训练仍需 NVIDIA 机器，不把 CPU CI 当成 CUDA 验证。

## 防复发

CI 在预取模型前执行 `scripts/smoke-training-setup.cjs`：无用户预装 Python、无模型缓存也能自行准备并完成真实训练/导出。打包后再次从实际 `robot-lab-mcp` 和 `app.asar.unpacked` 资源执行。该检查覆盖安装后的输入资源和环境，不仅检查构建是否成功。

官方安装依据：[PyTorch 2.9.1](https://pytorch.org/get-started/previous-versions/#v291)、[uv 管理 Python](https://docs.astral.sh/uv/guides/install-python/)、[uv 安装](https://docs.astral.sh/uv/getting-started/installation/)。
