# Backend boundaries

Real training and evaluation accept separate PyTorch device choices: MPS on Apple Silicon, CUDA on NVIDIA, CPU when explicitly selected. An unavailable device fails; PYTORCH_ENABLE_MPS_FALLBACK=0 prevents silent CPU fallback. Install torch, mujoco, onnx and onnxruntime in the Python environment selected by DUCK_LAB_PYTHON or the laboratory page.

Physics currently uses native CPU MuJoCo on every model device. MPS training does not mean Metal GPU physics. CUDA model execution is implemented through PyTorch device routing but awaits NVIDIA hardware verification. No Warp adapter is provided. GPU models with small rollouts may be slower than CPU; device availability is not a performance claim.

The existing Electron pet and 3D laboratory preview run ONNX Runtime Web WASM on CPU. Native MPS/CUDA inference is used for training rollouts and Python candidate evaluation. No native device service replaces the desktop control loop. Native and browser MuJoCo versions can differ, hence the separate browser admission check.

2026-09-08: real local MPS training and inference, ONNX export and browser evaluation passed. CUDA remains pending hardware verification; an unavailable-CUDA rejection is not a successful CUDA test.

HF Jobs is Hugging Face's managed remote execution service. It is optional infrastructure, not an algorithm or dependency of this implementation. This service does not submit paid jobs.

Official references:
- https://docs.pytorch.org/docs/stable/notes/mps.html
- https://huggingface.co/docs/hub/jobs
