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

## Reachy Mini

- `renderer/public/assets/reachy-mini/reachy_mini_viz.glb`: official Pollen Robotics
  Reachy Mini rig from `pollen-robotics/reachy-mini-desktop-app`, commit
  `467ad30e00855cd5051c8483fed00b4e00b57d1a`, SHA-256
  `bf64c307200461d76224fe6b2370604e0e6cbce1c6eab3fb9b8795410a86ef1c`.
  The desktop repository is Apache-2.0; Pollen's hardware/3D design assets are
  treated as CC BY-SA-NC, consistent with this app's existing non-commercial assets.
- `renderer/src/runtime/reachy-rig.js`: calibration and neck CCD adapted from
  that repository's `src/components/viewer3d/GLTFRobot.tsx` (Apache-2.0).
  Modified to use plain Three.js and a transparent desktop renderer.
- `renderer/public/assets/reachy-mini/draco/`: Google Draco decoder distributed
  with Three.js (Apache-2.0). The license is included alongside the Reachy assets.
- `renderer/public/assets/reachy-mini/*.wav`: official Apache-2.0 SDK audio from
  `pollen-robotics/reachy_mini` commit `234a978e4426895fc88d864e7f154643aea77f53`.
  `wake.wav` = `wake_up.wav`, `sleep.wav` = `go_sleep.wav`,
  `chirp.wav` = `impatient1.wav`, `error.wav` = `confused1.wav`.
  WAV headers canonicalized; PCM samples, channels and sample rates unchanged.
- LAN protocol references: `pollen-robotics/reachy_mini`, commit
  `234a978e4426895fc88d864e7f154643aea77f53`, `io/protocol.py`,
  `utils/discovery.py`, and `daemon/app/routers/media.py`. Remote audio upload
  and playback endpoints were also checked against the `v1.9.0` tag.

## Microduck sounds

- `renderer/public/assets/servo/` steps and landings: cut from "Small servo (arduino)" by gpag1, CC0 (https://freesound.org/people/gpag1/sounds/520514/). Single moves of a real hobby servo, high-passed at 90 Hz, faded and peak-normalised to -3 dBFS.
- `renderer/public/assets/voices/duck1..duck4/`: voice banks from the same Space snapshot, treated as CC BY-SA-NC.
- `assets/sounds/complete.mp3`: "DELETRAZ_Ludivine_2019_2020_notification.wav" by iut_Paris8, CC0 (https://freesound.org/people/iut_Paris8/sounds/510287/).

## Agent icons

`assets/icons/agents/` derived from `@lobehub/icons-static-png@1.95.0` (https://lobehub.com/icons).

## Demo video

`docs/media/demo.gif` and the `duck-on-desk-demo.mp4` release asset show the app over the Pollen Robotics
Microduck web page. Music: "Fluffing a Duck" by Kevin MacLeod (https://incompetech.com), Creative Commons
Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).
