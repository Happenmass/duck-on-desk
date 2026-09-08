# Robot Lab MCP 0.2

Robot Lab provides a full 3D Microduck window and real residual PPO training using native CPU MuJoCo physics. Model training and evaluation run on the requested PyTorch CPU/MPS/CUDA device. CUDA awaits hardware verification. The desktop renderer continues using ONNX Runtime Web WASM.

Coding Agent workflow:
1. lab_docs_search / lab_docs_read, or resources/read lab://docs/scripts.
2. lab_backends_inspect discovers actual local device availability.
3. lab_experiment_create with mode="robot" creates real reward/network/config templates. Default mode="probe" preserves the separate synthetic device test.
4. lab_experiment_read / lab_experiment_write edit reward.py, strategy.py, training.json with expected_revision. Writes save drafts without running them.
5. lab_experiment_validate checks config, syntax and function signatures without executing scripts. This is not a numerical or safety check.
6. lab_training_start executes the exact expected_revision and returns a run ID immediately.
7. lab_training_get / lab_training_list show real environment steps, reward curves, failures and native evaluation. lab_training_cancel requests cancellation at the next rollout boundary.
8. lab_policy_artifact returns a verified ONNX, checkpoint, preview or manifest path in the global model cache.
9. In Robot Lab, select that run, preview it and run browser physics evaluation. Apply is available only after native and browser admission checks. Restore previous policy or export ONNX with its manifest from the same page.

Each draft write increments revision; stale writes and starts return REVISION_CONFLICT. Jobs snapshot the scripts, settings and source revision. Draft history retains ten prior snapshots. DUCK_LAB_HOME defaults to ~/.duck-on-desk/robot-lab; training weights live in ~/.cache/huggingface/microduck-robot-lab/<run_id>.

Python scripts execute with local user privileges, not in a sandbox. Only execute trusted project code. Probe timeout is 45 seconds; real jobs are bounded to 30 minutes and 500 iterations. The timeout does not guarantee termination of descendants created by user code. The MCP uses stdio, launches no Electron app or hardware adapter, and submits no paid jobs.

Closing the laboratory window destroys its 3D renderer; jobs continue in their owning App/MCP process. Quitting that process stops its running jobs. Checkpoints are real PyTorch actor/critic/optimizer snapshots; automatic resume and arbitrary RL algorithm plugins are not implemented.
