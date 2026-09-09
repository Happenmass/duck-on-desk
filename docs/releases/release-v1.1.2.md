# Duck on Desk v1.1.2

修复新机器首次训练提示 `Microduck model / base policy unavailable; install model assets first` 的问题。

- 训练开始前自动补齐固定版本的 Microduck 基础策略，保存到用户 Hugging Face 缓存。训练服务不再记住不存在的旧包内路径。
- “Python 环境”留空即可自动安装独立的 Python 3.12、PyTorch、MuJoCo 与 ONNX 依赖；也可点击“检查 / 安装训练环境”提前准备。已有自定义环境只检查，不修改。
- Windows x64 默认 CUDA，Apple Silicon 默认 MPS。CUDA 安装使用 PyTorch 2.9.1 / CUDA 12.8 wheel；启动前检查实际 GPU 计算。不可用时显示原因，不自动退回 CPU。
- 首次下载和环境检查显示进度，失败后可重试；训练的准备阶段也可以停止。MCP 新增环境安装与状态查询接口。
- 保留 1.1.1 的默认 30 秒重置、可配置重置时间与历史续训设置。

首次安装需要网络及可用磁盘空间，CUDA 依赖下载较大。CUDA 需要受支持的 NVIDIA 显卡和驱动；本版自动安装不代替显卡驱动安装。自动环境支持 Windows x64、Apple Silicon；Intel Mac / Windows ARM 用户可填写自行配置的 Python。CUDA 实际训练仍待 NVIDIA 机器验证，Windows CPU 验证不能代替它。
