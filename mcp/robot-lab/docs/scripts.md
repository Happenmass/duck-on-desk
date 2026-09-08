# Script and configuration API

## Real robot training: mode="robot"

reward.py defines reward_environment(state, action, next_state). State dictionaries contain float32 [batch] tensors on the training device: forward_velocity (body-frame m/s), height (metres), upright (cosine, -1..1), target_speed (m/s). action is float32 [batch,14], the policy's joint offsets in radians. Return finite [batch] rewards. Falling adds a fixed penalty of -2 in the runner.

strategy.py defines build_policy(observation_dim, action_dim), returning a trainable torch.nn.Module with finite [batch,14] output for [batch,61] input. The runner adds 0.08*tanh(network(obs)) to the frozen base policy's output. The default final layer starts at zero. Change the reward, network and bounded PPO settings through these files; algorithm plugins are not supported.

training.json keys:
- schema_version: 1; mode: "robot"; task: "microduck-flat-walk"; algorithm: "ppo"
- training_device and inference_device: "cpu" | "mps" | "cuda"
- physics_backend: "mujoco_cpu" (Warp is not implemented)
- max_iterations: 1..500; seed: integer 0..2147483647
- environments: 1..32, default 4
- rollout_steps: 8..256, default 32
- learning_rate: 0.000001..0.01, default 0.0003
- target_speed: 0..0.25 m/s, default 0.15

The environment uses the app's ordinary-feet MJCF and chosen_actuator model. Observation contract duck-lab-legs-v1: gyro 3, projected gravity 3, joint position minus default pose 14, joint velocity 14, previous action 14, commands 13. Joint order and pose are recorded in training/contract.json. Normalization is baked into ONNX. Control targets are default pose + action; MuJoCo applies actuator limits. Physics timestep 0.005 s, decimation 4, control period 0.02 s. No desktop recentering, stride credit, gait kick or assisted recovery enters laboratory physics.

Episode ends after 500 steps or when base height <0.06 m or upright <0.4. Native evaluation compares base and candidate over 3 seeded environments, 250 steps each. Admission requires no extra falls and velocity MAE <= base+0.03 m/s. Browser evaluation compares both in WASM, 250 steps each; admission requires no extra falls and MAE <= base+0.05. These short non-regression gates do not establish long-term locomotion quality. The scene has a flat floor; terrain curricula and imitation learning are future work.

Export records model/contract/script hashes, device choices, optimizer updates, evaluation metrics and ONNX SHA-256. Base import and ONNX export are numerically checked at tolerance 0.002. Only ordinary-feet walking uses an activated artifact; roller/stilt policies retain their matching models. Returning to ordinary feet restores the selected lab policy.

## Separate synthetic probe

In mode="probe" (the default), reward.py defines reward(observation, action, next_observation), taking tensors [batch,61], [batch,14], [batch,61] without physical semantics. Return [batch] rewards. lab_backend_probe uses the explicit device argument and draft seed, and performs exactly three synthetic gradient steps. Its robot_environment_steps=0. Do not treat it as robot training. Existing probe configs may omit mode and optional rollout settings.

Drafts may contain invalid code. Validation only parses syntax/signatures and configuration. Real execution checks devices, reward/action shape, finite losses, parameter changes and export parity; no unavailable-device fallback is performed.
