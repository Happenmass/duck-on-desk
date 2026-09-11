# Backend boundaries

Real training and evaluation accept separate PyTorch device choices: MPS on Apple Silicon, CUDA on NVIDIA, CPU when explicitly selected. An unavailable device fails; PYTORCH_ENABLE_MPS_FALLBACK=0 prevents silent CPU fallback. Leave Python blank for automatic isolated installation, or select an existing environment via DUCK_LAB_PYTHON or the laboratory page.

Physics currently uses native CPU MuJoCo on every model device. MPS training does not mean Metal GPU physics. CUDA model execution is implemented through PyTorch device routing but awaits NVIDIA hardware verification. No Warp adapter is provided. GPU models with small rollouts may be slower than CPU; device availability is not a performance claim.

The existing Electron pet and 3D laboratory preview run ONNX Runtime Web WASM on CPU. Native MPS/CUDA inference is used for training rollouts and Python candidate evaluation. No native device service replaces the desktop control loop. Native and browser MuJoCo versions can differ, hence the separate browser admission check.

2026-09-08: real local MPS training and inference, ONNX export and browser evaluation passed. CUDA remains pending hardware verification; an unavailable-CUDA rejection is not a successful CUDA test.

HF Jobs is Hugging Face's managed remote execution service. It is optional infrastructure, not an algorithm or dependency of this implementation. This service does not submit paid jobs.

Official references:
- https://docs.pytorch.org/docs/stable/notes/mps.html
- https://huggingface.co/docs/hub/jobs

## First-run setup (1.1.2)

Leaving the laboratory Python field empty now installs a private Python 3.12 environment under `~/.duck-on-desk/training-runtime/`. `lab_training_start` immediately returns a `preparing` job; poll `lab_training_get` for its `preparation` message, then training metrics. Cancellation also works during preparation. Existing explicit Python paths are probed, never modified; clear an invalid path to request the managed environment.

Use `lab_environment_setup({training_device:"cuda",inference_device:"cuda"})` to prepare without executing reward scripts or starting training. It returns immediately; poll `lab_environment_status` until `ready` or `failed`. Retry the setup call after correcting a failure. These operations download from GitHub (checksum-pinned uv 0.8.22), Hugging Face (commit-pinned Microduck policy), PyPI and the official PyTorch wheel index. No administrator privileges or system PATH changes are required. The standalone MCP uses the same preparer as the UI.

Managed dependencies come from the pinned `pollen-robotics/microduck_rl` commit 53b8971 and its uv.lock (`uv sync --frozen`, Git required): Python 3.12, mjlab 1.3.0, mujoco-warp 3.8.1, warp-lang 1.12.0, rsl-rl-lib 5.0.1, torch 2.9.1, numpy 2.4.1, mujoco 3.10.0, onnx 1.22.0, onnxruntime 1.24.4. Windows x64 CUDA additionally reinstalls torch 2.9.1 from the cu128 wheel index (PyPI ships CPU-only torch on Windows); Apple Silicon installs the macOS wheel with MPS; an explicitly selected CPU backend uses CPU wheels. The preparer checks imports and an actual gradient operation on every requested device before training. It does not install NVIDIA drivers, and never substitutes CPU for a requested unavailable GPU. Intel macOS and Windows ARM require a custom Python environment for this recipe.

Installation references: https://pytorch.org/get-started/previous-versions/#v291 ; https://docs.astral.sh/uv/guides/install-python/ ; https://docs.astral.sh/uv/getting-started/installation/
