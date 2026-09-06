# Notices

## Derived work

duck-on-desk is a derivative of **Clawd on Desk** (https://github.com/rullerzhou-afk/clawd-on-desk),
Copyright (C) 2026 rullerzhou-afk and contributors, licensed under the GNU AGPL-3.0-only.
Baseline imported from upstream commit 5ca26b5c (2026-09-04). Modifications:
renamed product identity, removed 20 agent integrations and optional subsystems
(Remote SSH, Telegram/Feishu/Slack/Discord, recap, Kimi quota, tutorial, mobile preview),
and replaced the sprite renderer with a physics-driven 3D duck. See git history for details.

## 3D duck assets

Mesh, MJCF and kinematics assets under `renderer/public/robot/` and the material/variant
code derived from the Pollen Robotics Microduck simulator
(https://huggingface.co/spaces/pollen-robotics/microduck-simulator, commit 183f99a40bd7308da3e848de961ed32bb02624a5).
The `microduck_rl` README states its 3D model files are CC BY-SA-NC; the Space declares no
license for its glue code. Non-commercial use only until clarified with Pollen Robotics.
The ONNX policy weights from the same Space (walking, sit/stand, stand-up, ground pick, roller,
roller crouch) are bundled under `resources/policies/` so the app works without a download; the
Space declares no licence for them, so they are treated like the other Space assets above.
The community stilt policies bundled alongside (`HannesVonEssen/microduck-stilts`, Apache-2.0)
were trained in `Vottivott/microduck-playground` (Apache-2.0).

## Sounds

- `renderer/public/assets/sfx/` footsteps and thumps: CC0 samples from Kenney.nl ("Impact Sounds"), trimmed by the Space.
- `renderer/public/assets/voices/duck1..duck4/`: voice banks from the same Space snapshot, treated as CC BY-SA-NC.
- `assets/sounds/complete.mp3`: "DELETRAZ_Ludivine_2019_2020_notification.wav" by iut_Paris8, CC0 (https://freesound.org/people/iut_Paris8/sounds/510287/).

## Agent icons

`assets/icons/agents/` derived from `@lobehub/icons-static-png@1.95.0` (https://lobehub.com/icons).
