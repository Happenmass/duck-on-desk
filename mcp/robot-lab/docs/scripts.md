# Script and configuration API

## Walking training: mode="robot", task="microduck-flat-walk"

reward.py defines reward_environment(state, action, next_state). State dictionaries contain float32 [batch] tensors on the training device: forward_velocity (body-frame m/s), height (metres), upright (cosine, -1..1), target_speed (m/s), heading_error (radians in [-pi,pi], relative to the initial world +X heading), and yaw_rate (body/IMU angular velocity around Z, rad/s). The two heading fields were added in the 2026-09-09 development build; installed 1.0.0 does not expose them. action is float32 [batch,14], the policy's joint offsets in radians. Return finite [batch] rewards. Falling adds a fixed penalty of -2 in the runner. Body-frame forward speed alone can reward walking in circles; a straight-walking reward should also penalize heading error and turning.

strategy.py declares build_policy(observation_dim, action_dim), returning the official torch.nn.Sequential architecture: Linear(61,512), ELU, Linear(512,256), ELU, Linear(256,128), ELU, Linear(128,14). All 197,774 actor parameters are trainable. policy_initialization selects original walking weights/normalization or random weights/identity normalization; new walking drafts default to official, new hold drafts default to random. There is no residual network, output zeroing, command mask inside the actor, or reference-angle correction clamp. Incompatible old network drafts fail explicitly before optimization; saved history is not rewritten. The UI displays the fixed architecture read-only; reward scripts and bounded PPO settings remain editable. Algorithm plugins are not supported.

training.json keys:
- schema_version: 1; mode: "robot"; task: "microduck-flat-walk"; algorithm: "ppo"
- training_device and inference_device: "cpu" | "mps" | "cuda", default "mps" for both
- physics_backend: "mujoco_cpu" (Warp is not implemented)
- max_iterations: 1..2000, default 200; seed: integer 0..2147483647, default 2
- environments: 1..32, default 8
- rollout_steps: 8..256, default 128
- learning_rate: 0.000001..0.01; new walk default 0.0001, hold default 0.0003; initial value and ceiling for local-ppo-v2
- target_speed: 0..0.25 m/s, default 0.25

A real job has a 2-hour wall-clock budget, enforced by both the parent process and the training loop. Raising iterations does not extend that budget.

Fresh workbenches and robot drafts use the 2026-09-09 verified MPS recipe above, with heading/yaw penalties of 5.0/0.02 in the default reward. Saved workbench settings override factory defaults. Read lab_training_defaults for the effective settings before creating a draft. CUDA remains unverified on hardware.

The environment uses the app's ordinary-feet MJCF and chosen_actuator model. Observation contract duck-lab-legs-v1: gyro 3, projected gravity 3, joint position minus default pose 14, joint velocity 14, previous action 14, commands 13. Joint order and pose are recorded in training/contract.json. Normalization is baked into ONNX. Control targets are default pose + action; MuJoCo applies actuator limits. Physics timestep 0.005 s, decimation 4, control period 0.02 s. No desktop recentering, stride credit, gait kick or assisted recovery enters laboratory physics.

Episode ends after 500 steps or when base height <0.06 m or upright <0.4. Native evaluation compares base and candidate over 3 seeded environments, 250 steps each. Admission requires no extra falls and velocity MAE <= base+0.03 m/s. Browser evaluation compares both in WASM, 250 steps each; admission requires no extra falls and MAE <= base+0.05. These short non-regression gates do not establish long-term locomotion quality. The scene has a flat floor; terrain curricula and imitation learning are future work.

Export records model/contract/script hashes, device choices, optimizer updates, evaluation metrics and ONNX SHA-256. Base import and ONNX export are numerically checked at tolerance 0.002. Only ordinary-feet walking uses an activated artifact; roller/stilt policies retain their matching models. Returning to ordinary feet restores the selected lab policy.

## Lesson 2 — balance first: task="microduck-headstand-hold"

Use `lab_experiment_create({name, mode:"robot", task:"microduck-headstand-hold"})` or `lab_training_defaults({task:"microduck-headstand-hold"})`. This is the current second lesson. It starts from a physically sampled near-head-support pose, with seeded initial angular/joint velocity perturbations. No continuing external force, gravity change, pose pinning or recovery assist is applied. This reset is provided by the environment, **not a learned flip from standing**.

`training/headstand-hold.json` contains the shared native/WASM initial pose and reference joint targets (`headstand-hold-v1`). The pose supplies environment initialization only; it is not added to policy outputs. The actor uses the official architecture with 61 inputs / 14 position offsets, defaulting to random weights for this lesson (official walking initialization remains an explicit comparison option). Actions are not restricted to ±0.2 rad around the reference. PPO exploration standard deviation decreases from 0.04 to 0.01 rad across the configured run, with the same value used for rollout likelihoods and that iteration's PPO update.

The reward script adds body-angle/alignment/leg-height/head-contact terms, scaled by inversion, plus strict continuous-hold reward. Body tilt is acos(-upright), in radians, relative to vertically inverted; its score is exp(-(tilt/0.5)^2). There is no reward for matching a fixed joint pose. `reference_joint_error` remains available only for compatibility with older saved reward scripts (mean squared joint deviation, rad²). It retains all headstand posture fields below and editable `reward_environment` / optional verified `reward_components`. There is no inversion-progress reward in this lesson. Body/feet contact, actual motion, joint limits and abrupt commands incur penalties. After 0.5 seconds, losing inversion (upright >−0.6) or other-body ground contact ends a training episode with the environment's −2 penalty; invalid simulation also ends it. Maximum episode duration remains 8 seconds.

Evaluation never applies these training resets: native runs 3 seeded starts and WASM runs one small fixed disturbance, each for 400 control steps. The strict posture conditions below must hold throughout the **final 2 seconds**. Results explicitly report `goal="headstand-hold"`, `initialization="near-headstand"`, `evaluation_version="headstand-hold-v1"`. Initialization does not increment the hold timer. A success is only a balance-practice result; role remains `practice`, never admitted as a desktop action or replacement walker.

The previous `microduck-headstand` jobs keep their standing starts and original evaluation semantics. They remain accessible under “历史实验 · 从站立翻转（旧）” or MCP. Current route: learn balance → learn entry from standing → return upright → dance. Later stages are not implemented by this change. Default settings are exploratory, not a promised successful training recipe. MPS is tested locally; CUDA still awaits hardware verification.

## Legacy standing-start entry experiment: task="microduck-headstand"

Create a robot draft or request defaults with this task. It shares the same 61-input, 14-output phase observation contract and 8-second standing-start simulation as the dance task. The goal and evaluation are separate: enter and hold a head-supported inversion; no hopping or return to standing. Factory parameters: MPS for training/inference, 200 iterations, 8 environments, 128 rollout steps, learning rate 0.001, seed 2. This is an experimental recipe, not a demonstrated successful skill.

Editable `training/headstand-reward.py` now uses **posture v2**. Sustained reward requires head support, no feet/other-body floor contact, feet above the base, inverted orientation, centre-of-mass alignment and low actual body/joint speeds. No fixed target joint pose is imposed. Main posture weight is 3; a continuous valid hold ramps to 2 over 2 seconds and resets on any failed condition. First-time inversion progress pays at most 0.5 over the entire 8-second episode, so repeated rolling cannot claim it again. Other-body floor contact costs 0.1 per step. Motion costs are 0.02×excess angular speed² above 2 rad/s (excess capped at 5), 0.01×horizontal speed² (capped at 4), 0.005×joint RMS speed² (capped at 100), and 0.05×normalized proximity to joint limits² (capped at 2 before squaring). Squared command and command-change costs remain 0.0002 and 0.005. See the editable script for the smooth posture factors. These are exploratory weights; passing counterexamples is not proof that a policy can learn the maneuver.

Headstand-only float32 state fields, on the training device:

| Field | Shape | Meaning |
| --- | --- | --- |
| head_contact / feet_contact / body_contact | [batch] | Floor contact by head, either foot, or any remaining body/leg geometry; distance ≤0.001 m |
| feet_height / feet_above_base | [batch] | Lower foot geometry-centre height / its height above root base, metres |
| support_offset | [batch] | XY distance of whole-body subtree COM from mean head-floor contact position, metres; head COM fallback without contact. A geometric approximation, not a force or support-polygon test |
| angular_speed / horizontal_speed | [batch] | IMU gyro norm (rad/s) / root XY velocity norm (m/s) |
| joint_positions / joint_velocities | [batch,14] | Actual physical joint angles (rad) / velocities (rad/s), in contract joint order |
| joint_speed | [batch] | RMS of 14 actual joint velocities, rad/s |
| joint_limit_margin | [batch] | Minimum distance to either limit, divided by that joint's travel; negative means past a limit |
| best_inversion | [batch] | Best (1−upright)/2 reached this episode, 0–1; reset per robot |
| hold_seconds | [batch] | Uninterrupted time satisfying every v2 success condition; invalid posture resets immediately |

State reads do not advance history; each physical control step updates it once. Inputs/outputs remain 61/14. Training exploration standard deviation remains 0.3 rad; walking/dance defaults are unchanged.

Native and WASM evaluation report `evaluation_version="headstand-posture-v2"`. Both start standing without recovery assists and run 400 control steps. Success requires the **final continuous 2 seconds** with upright <−0.8, head touching, neither feet nor any other body/leg geometry touching, feet_height >0.08 m, feet_above_base >0.04 m, support_offset <0.04 m, angular_speed <1 rad/s, horizontal_speed <0.1 m/s, joint_speed <2 rad/s and joint_limit_margin ≥−0.02. The last tolerance allows small solver limit excursions. Native uses 3 seeded starts and requires all to pass; its hold metrics are the minimum across the 3. Browser measures one episode. Old job snapshots are preserved under their original criteria.

Optional `reward_components(state, action, next_state)` returns a dictionary of named finite [batch] tensors (up to 32 entries). The runner evaluates it once over the collected rollout batch and verifies that its sum matches the **actual** `reward_environment` output. It never replaces that output. Missing, invalid or inconsistent decomposition is explicitly marked and omitted from the UI. Verified per-step component means and the runner's separate automatic penalty reconcile to `mean_reward`. Custom scripts without this optional function still work.

Per-iteration `headstand_max_hold_seconds` is the maximum continuous hold reached by **any** sampled robot during that rollout, including time spanning earlier rollout boundaries. `headstand_valid_percent` is the percentage of all sampled steps satisfying v2 posture. These are training diagnostics, not the final three-episode pass criterion. Historical jobs without these fields show missing data, not zero. PPO clips probability ratios in its objective, not rewards to [0,1].

The ONNX manifest has role="practice", contract="duck-lab-action-v1" and task="microduck-headstand". It can be previewed, evaluated and exported, but cannot replace the walker or enter the desktop action library: getting back to standing is not trained yet. Preview stops after 8 seconds at the current pose. Historical dance experiments and their stricter full-action admission remain unchanged.

## Deferred street dance (legacy contract): task="microduck-headstand-dance"

Use `lab_experiment_create({name, mode:"robot", task:"microduck-headstand-dance"})` or `lab_training_defaults({task:"microduck-headstand-dance"})`. This is a preserved legacy experiment, not the current lesson. Its UI course entry is removed. First train microduck-headstand-hold, then entry from standing and a return to upright; resume street dance only after the full standing-to-standing sequence works. The legacy recipe has not succeeded. Existing walking defaults and its active policy are kept separately.

The same editable reward.py / strategy.py / training.json and start/get/cancel/artifact tools apply. Defaults: MPS training and inference, 200 iterations, 8 environments, 128 rollout steps, learning_rate=0.0003, seed=2. Each 8-second episode starts from STAND. `target_speed` is forced to zero. Inversion is intentional: the walking fall termination and fall penalty are not used; episodes end at 400 control steps or invalid physics.

Additional reward state: `phase` float32 [batch] in 0..1, `ground_contact` float32 [batch] (any contact with the floor), `previous_action` float32 [batch,14]. New full-finetuning jobs preserve the official command-slot meanings: action tasks use zero velocity/head commands and expose phase only to the reward script. Their manifest records policy_observations="official-zero-commands-v1". Old residual artifacts retain their original phase observations [cos(2*pi*phase), sin(2*pi*phase), phase] in slots 48:51 during replay. The browser dispatches by manifest metadata; never feed new observations to historical policies. Physical actuator/joint limits remain in MuJoCo. Action artifacts are NOT admitted as walking policies.

The manifest uses contract="duck-lab-action-v1", role="action", task="microduck-headstand-dance", duration=8. Native admission checks 3 complete, independently perturbed standing-start episodes without resets or recovery assists: upright<-0.7 for at least 0.4 s, at least one airborne interval of 2 control steps followed by contact while still inverted, and the final 0.4 s upright>0.85, height>0.085 m, horizontal speed<0.08 m/s. All three episodes must pass. The browser repeats a full 400-step episode with the same criteria. These minimal checks do not establish dance quality or hardware suitability; inspect the candidate visually.

The legacy full-action inspection and admission code is retained, but its course is no longer selectable in Robot Lab. Read old runs and artifacts with lab_training_list / lab_training_get / lab_policy_artifact. Failed candidates remain available for inspection but cannot enter the library. `lab_actions_list` reads the built-in peck and admitted trained actions; admission/removal lives in the Lab UI. The library is stored as action metadata in DUCK_LAB_HOME/actions.json; weights remain in the global HF cache. Adding an action does not replace the walking policy. The right-click Actions menu refreshes on addition/removal; ordinary-feet walking may randomly play it every 25–55 seconds of eligible continuous walking. Each playback settles before and after the action; sleep, grab and semantic state changes interrupt it.

2026-09-09 first real MPS run: 204,800 steps and valid ONNX export, but 0 inverted seconds / 0 inverted hops in native and browser checks. It did not learn headstand dancing and was not admitted. Learning the actual maneuver needs further reward/curriculum or demonstration work; merely increasing iterations is not a verified solution. CUDA remains pending hardware verification.

## Separate synthetic probe

In mode="probe" (the default), reward.py defines reward(observation, action, next_observation), taking tensors [batch,61], [batch,14], [batch,61] without physical semantics. Return [batch] rewards. lab_backend_probe uses the explicit device argument and draft seed, and performs exactly three synthetic gradient steps. Its robot_environment_steps=0. Do not treat it as robot training. Existing probe configs may omit mode and optional rollout settings.

Drafts may contain invalid code. Validation only parses syntax/signatures and configuration. Real execution checks devices, reward/action shape, finite losses, parameter changes and export parity; no unavailable-device fallback is performed.

## Fine-tuning provenance

Official-initialized manifests record training_method="official-full-finetune-v1", policy_architecture=[61,512,256,128,14], trainable_policy_parameters=197774, initial_policy_sha256, per-tensor parameter_changes, base_import_max_error and onnx_export_max_error. The value critic is a separate training-only network; it is not exported, and we do not claim it duplicates the official training critic (the deployed ONNX contains only the actor). In official initialization, normalization statistics remain fixed at their original exported values; all actor Linear weights/biases update.

Factory defaults now come from presets/official-finetune, with lr=.0001 as a starting value for full-network training. The old stable-flat-walk preset and its quality evidence remain historical residual-training artifacts, not a success guarantee for this method. Recognized old factory workbench network/lr are migrated on reading defaults; custom reward and other settings are preserved. Old experiment files are never silently overwritten.


## Continue training from a checkpoint

`lab_training_resume({run_id, additional_iterations: 200})` creates a NEW run from the selected stopped/completed/failed official-full-finetune-v1 run. `additional_iterations` is 1–2,000, added to the saved cumulative iteration (not a replacement total). Each segment retains the two-hour limit; accumulated training can exceed 2,000 rounds. The source reward, actor architecture, optimizer learning rate, devices, seed, environment count and rollout length are preserved. Editing a draft does not affect resume. Start a new draft to change the experiment.

New checkpoints save every 10 full iterations, on the final iteration, and on a cooperative stop at the next iteration boundary. They atomically replace checkpoint.pt in the new run's global model-cache directory and contain actor, critic, Adam state, cumulative steps/iteration, exploration schedule, MuJoCo integration state, environment counters and RNG states. Resume keeps exploration on the original schedule and clamps to its final level beyond the original horizon; it never restarts exploration at .04 rad. Simulator contacts/sensors are rebuilt on load; bit-identical trajectories across restarts/hardware are not promised. Stateful custom-script globals are not serialized.

The list/get response includes `resume.available`, `reason` when unavailable, saved `iteration` and `environment_steps`, and `legacy` for older official checkpoints. `checkpoint` includes the saved SHA-256. Active runs cannot be resumed until stopped. Missing/tampered checkpoints, changed task/config/model or incompatible legacy residual actors are rejected. Existing official full-finetuning checkpoints restore actor/critic/optimizer and counters, but restart episodes because they lack saved simulation and device RNG state.

`lab_policy_artifact({run_id, kind:"checkpoint.pt"})` also works for stopped/failed resumable runs. ONNX/evaluation/activation still require completed training. Unexpected process exit can lose iterations since the last checkpoint; a normal stop completes and saves the current iteration. Closing the lab window keeps training; quitting the owning process requests stop but forced shutdown can only rely on the last persisted checkpoint.

Progress `iteration`/`environment_steps` is cumulative; `session_iteration` is this segment's progress. Curves show only the new segment and retain cumulative x-axis numbering; source history remains in the original run. Manifests record resume_run_id, resume_iteration, resume_checkpoint_sha256, session_iterations and restored_simulation. New training uses its selected initialization option. Resume loads the selected learned weights regardless of current defaults.


## Initialization selection (current lesson defaults, 2026-09-09)

Robot training.json accepts policy_initialization="official" or "random". New walking drafts default to official; new microduck-headstand-hold drafts default to random. Old saved drafts without the field retain official initialization. The UI exposes the same choice under “新训练的起点”. Network architecture remains 61→512→256→128→14 / ELU in both cases; every layer trains.

Official initialization loads all original walking parameters and input normalization. Random initialization uses PyTorch Linear.reset_parameters with the run's seed, including a nonzero random output layer; mean=0, scale=1, so no walking observation statistics are reused. The ONNX exports the same input processing used in training. The official policy is still read for architecture validation and as an evaluation reference; it is not the random actor's starting weights. New critic parameters are random in either mode.

Random manifests use training_method="random-actor-ppo-v1", policy_initialization="random", input_normalization="identity", initial_policy_sha256=null. starting_actor_sha256 fingerprints the actual actor at the start of this segment (after checkpoint load for resume). reference_policy_sha256 identifies the official comparison policy. Resuming restores the selected checkpoint including normalization and optimizer; it keeps that run's initialization lineage and reward, ignoring current new-training defaults. Random-initialized and earlier official-initialized runs both support resume; residual architectures do not.

The headstand environment still resets near the inverted support pose with small seeded velocity perturbations. Randomizing network parameters does not randomize the robot's body arbitrarily. The hold reward targets body verticality, support alignment and stability, with no fixed-joint-pose bonus. Original MJCF joint limits remain; no additional narrow joint-output clipping is applied.


## Versioned PPO recipe (2026-09-09)

Robot training.json accepts ppo_profile: "local-ppo-v2" or "legacy-v1". Newly created drafts contain local-ppo-v2; existing drafts missing this field retain legacy-v1 at start. To opt in, edit this field explicitly. New sampling defaults: environments=32, rollout_steps=64, max_iterations=200. Constraints remain 1..32 environments, 8..256 steps, 1..2000 iterations and two hours per segment. New walking learning_rate=.0001; hold=.0003. Existing workbench values remain editable; the UI recommendation button replaces sampling settings without replacing reward or initialization.

local-ppo-v2: 5 epochs × 4 shuffled minibatches (512 samples at the default batch), gamma=.99, GAE lambda=.95, ratio/value clipping=.2, value coefficient=1, max gradient norm=1, desired KL=.01, adaptive learning rate in [1e-6, configured learning_rate], entropy coefficient=.001. Critic: 61→512→256→128→1 / ELU. Trainable Gaussian log_std per action starts at .15 for random actors or .025 for pretrained actors and is bounded to standard deviations .01.. .5; this is not a joint-range or actor-output clamp. Time-limit truncations bootstrap value; falls do not. The original reward curve excludes the bootstrap correction.

Each metrics event additionally includes approx_kl (analytic old-to-new Gaussian KL, despite historical-style field name), clip_fraction, entropy, explained_variance (null for constant returns), learning_rate, optimizer_updates, minibatch_size, exploration_std. Losses are means across the minibatch updates; legacy losses retain their original last-update semantics. Manifest records ppo, critic_architecture, batch_size and final_learning_rate. This local recipe does not claim to reproduce official GPU physics, privileged critic observations, online normalization, reward scales or exact historic BEST_alpha weights training.

Checkpoint resume preserves ppo_profile and the source hyperparameters. The exploration state and Adam learning rate restore with the actor/critic. Old missing-profile checkpoints use legacy-v1, without silently changing shapes or optimizer parameter groups.


## Hold recovery (2026-09-09)

`reset_on_pose_loss` is an optional boolean in robot training.json. New hold drafts explicitly set false; old drafts/checkpoints lacking it retain true. It only affects the hold lesson. With false, finite trajectories continue after tilt, body contact or foot touchdown. New hold drafts explicitly set hold_episode_steps=1500: reset to the near-headstand start every 30 simulated seconds (50 control steps/second). Set 0 to disable time-based resets. The UI exposes this in seconds (0..1000). Resuming preserves the saved value, including 0; the new draft setting does not override an old checkpoint. hold_episode_steps accepts integers0..50000; absent means400 for old drafts/checkpoints. Nonzero values retain a time limit in control steps. No pose-loss terminal penalty is applied. Non-finite actions/rewards fail training. Default hold reward removes the foot-contact cost, without adding a touch/push bonus; other balance and motion terms stay intact. Strict hold_seconds still resets whenever support criteria fail, but that does not reset physics.

Metrics expose timeout_resets and failure_resets per rollout. Manifest/settings include reset_on_pose_loss; source checkpoint compatibility preserves both reset fields alongside the original reward. Resume never silently enables the new rule on an old record. Evaluation remains8seconds without mid-trial resets and requires a strict final2second hold.

In continuous hold training, phase=age/400 can exceed1; it is not a reset clock. The default hold reward does not use phase. Strict hold_seconds still measures consecutive supported headstand independently of simulation age.
