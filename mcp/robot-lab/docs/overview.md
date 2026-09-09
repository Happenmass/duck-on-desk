# Robot Lab MCP 0.2

Robot Lab provides a full 3D Microduck window and PPO fine-tuning of the full original official actor using native CPU MuJoCo physics. Model training and evaluation run on the requested PyTorch CPU/MPS/CUDA device. CUDA awaits hardware verification. The desktop renderer continues using ONNX Runtime Web WASM.

Coding Agent workflow:
1. lab_docs_search / lab_docs_read, or resources/read lab://docs/scripts.
2. lab_backends_inspect discovers actual local device availability.
3. lab_experiment_create with mode="robot" creates real reward/network/config templates. Default mode="probe" preserves the separate synthetic device test.
4. lab_experiment_read / lab_experiment_write edit reward.py, strategy.py, training.json with expected_revision. Writes save drafts without running them.
5. lab_experiment_validate checks config, syntax and function signatures without executing scripts. This is not a numerical or safety check.
6. lab_training_start executes the exact expected_revision and returns a run ID immediately.
7. lab_training_get / lab_training_list show real environment steps, reward curves, failures and native evaluation. lab_training_cancel requests cancellation at the next rollout boundary.
8. lab_policy_artifact returns a verified ONNX, checkpoint, preview or manifest path in the global model cache.
9. Start action training with task="microduck-headstand-hold" (practice only); lab_actions_list lists admitted actions. Learn balance from a provided near-headstand pose first, then entry from standing and returning upright. Street dance is deferred until that full sequence works. The headstand recipe has not learned the target yet. See lab://docs/scripts for phase observations and separate admission.
10. In Robot Lab, select that run, preview it and run browser physics evaluation. Apply is available only after native and browser admission checks. Restore previous policy or export ONNX with its manifest from the same page.

Each draft write increments revision; stale writes and starts return REVISION_CONFLICT. Jobs snapshot the scripts, settings and source revision. Draft history retains ten prior snapshots. DUCK_LAB_HOME defaults to ~/.duck-on-desk/robot-lab; training weights live in ~/.cache/huggingface/microduck-robot-lab/<run_id>.

Python scripts execute with local user privileges, not in a sandbox. Only execute trusted project code. Probe timeout is 45 seconds; real jobs are bounded to 2 hours and 2,000 iterations. The timeout does not guarantee termination of descendants created by user code. The MCP uses stdio, launches no Electron app or hardware adapter, and submits no paid jobs.

Closing the laboratory window destroys its 3D renderer; jobs continue in their owning App/MCP process. Quitting that process stops its running jobs. Checkpoints are real PyTorch actor/critic/optimizer snapshots; Use lab_training_resume to continue a stopped/completed official-network run. Arbitrary RL algorithm plugins are not implemented.

Start the action curriculum with task="microduck-headstand-hold": balance from a provided near-head-support pose and sustain the final 2 seconds. This does not train entering a headstand from standing. This practice model cannot enter the pet action library until a complete standing-to-standing maneuver is trained separately. The UI offers walking and headstand holding; historical standing-start experiments remain in a separate legacy selector entry. Returning upright is a future stage, not an implemented lesson. The old microduck-headstand-dance contract remains for historical compatibility, but its course entry is removed. Use lab_training_list / lab_training_get / lab_policy_artifact to inspect preserved dance records; do not use it as the current training curriculum.
