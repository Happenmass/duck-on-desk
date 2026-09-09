"""Script contract / device probes. This is NOT a MuJoCo environment or RL trainer."""
import ast
import contextlib
import io
import json
import math
import sys


def validate(payload):
    files = payload["files"]
    for name, function_name, argc in (("reward.py", "reward_environment" if payload.get("robot") else "reward", 3), ("strategy.py", "build_policy", 2)):
        tree = ast.parse(files[name], filename=name)
        defs = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == function_name]
        if len(defs) != 1 or len(defs[0].args.posonlyargs) + len(defs[0].args.args) != argc:
            raise ValueError(f"{name} must define {function_name} with {argc} positional arguments")
    return {"syntax_valid": True, "executes_scripts": False}


def inspect():
    import torch
    return {"python": sys.version.split()[0], "torch": torch.__version__,
            "model_devices": {"mps": torch.backends.mps.is_available(), "cuda": torch.cuda.is_available(), "cpu": True},
            "physics": {"current_desktop": "mujoco_wasm_cpu", "mps_gpu_physics": "not_supported_by_warp",
                        "mps_training": "cpu_physics_plus_mps_model", "cuda_training": "cpu_physics_plus_cuda_model_pending_hardware_verification"},
            "full_robot_training": "mujoco_cpu_official_full_finetune_ppo_onnx_export"}


def probe(payload):
    import torch
    validate(payload)
    device_name = payload["device"]
    if device_name not in ("cpu", "mps", "cuda"):
        raise ValueError("Unsupported device")
    available = inspect()["model_devices"][device_name]
    if not available:
        return {"ok": False, "code": "BACKEND_UNAVAILABLE", "requested_device": device_name, "fallback_used": False}
    device = torch.device(device_name)
    torch.manual_seed(payload["seed"])
    if device_name == "mps":
        torch.mps.manual_seed(payload["seed"])
    elif device_name == "cuda":
        torch.cuda.manual_seed_all(payload["seed"])
    torch.set_num_threads(1)
    reward_ns = {"__name__": "lab_reward"}
    strategy_ns = {"__name__": "lab_strategy"}
    exec(compile(payload["files"]["reward.py"], "reward.py", "exec"), reward_ns)
    exec(compile(payload["files"]["strategy.py"], "strategy.py", "exec"), strategy_ns)
    model = strategy_ns["build_policy"](61, 14).to(device)
    model.train()
    if not list(model.parameters()):
        raise ValueError("Policy must have trainable parameters")
    if any(p.device.type != device_name for p in model.parameters()):
        raise ValueError("Policy contains parameters on the wrong device")
    observation = torch.randn(16, 61, device=device)
    next_observation = torch.randn(16, 61, device=device)
    before = [p.detach().clone() for p in model.parameters()]
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    losses = []
    for _ in range(3):
        action = model(observation)
        if action.shape != (16, 14) or action.device.type != device_name or not torch.isfinite(action).all().item():
            raise ValueError("Policy must produce finite [batch,14] actions on the requested device")
        reward = reward_ns["reward"](observation, action, next_observation)
        if not isinstance(reward, torch.Tensor) or reward.shape != (16,) or reward.device.type != device_name or not torch.isfinite(reward).all().item():
            raise ValueError("Reward must produce finite [batch] rewards on the requested device")
        # Deliberately synthetic differentiable loss: validates the device/gradient
        # path, NOT PPO, the meaning of observation slots, or robot learning.
        loss = (action ** 2).mean() - 0.05 * reward.mean()
        optimizer.zero_grad()
        loss.backward()
        if not any(p.grad is not None for p in model.parameters()):
            raise ValueError("Policy produced no gradients")
        if any(p.grad is not None and not torch.isfinite(p.grad).all().item() for p in model.parameters()):
            raise ValueError("Non-finite gradients")
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
    if device_name == "mps":
        torch.mps.synchronize()
    elif device_name == "cuda":
        torch.cuda.synchronize()
    delta = sum(float((p.detach() - old).abs().sum().cpu()) for p, old in zip(model.parameters(), before))
    if not math.isfinite(delta) or delta <= 0:
        raise ValueError("Parameters did not update to finite values")
    model.eval()
    with torch.inference_mode():
        prediction = model(observation)
    if prediction.shape != (16, 14) or prediction.device.type != device_name or not torch.isfinite(prediction).all().item():
        raise ValueError("Inference must produce finite [batch,14] actions on the requested device")
    return {"ok": True, "scope": "synthetic_script_and_device_probe_not_robot_training",
            "requested_device": device_name, "parameter_device": next(model.parameters()).device.type,
            "inference_device": prediction.device.type, "fallback_used": False,
            "optimizer_steps": 3, "parameter_l1_change": delta, "losses": losses,
            "inference_shape": list(prediction.shape), "reward_shape": list(reward.shape),
            "reward_mean": float(reward.detach().mean().cpu()), "robot_environment_steps": 0}


def main():
    payload = json.load(sys.stdin)
    # User scripts run in this child process with local user privileges.
    # Captured stdout cannot corrupt the MCP transport; this is not a sandbox.
    with contextlib.redirect_stdout(io.StringIO()):
        if payload["operation"] == "validate":
            result = validate(payload)
        elif payload["operation"] == "inspect":
            result = inspect()
        elif payload["operation"] == "probe":
            result = probe(payload)
        else:
            raise ValueError("Unknown operation")
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "code": "SCRIPT_OR_BACKEND_ERROR", "message": str(error)[:1200]}))
        sys.exit(1)
