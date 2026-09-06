# Duck on Desk

English | [简体中文](README.zh-CN.md)

A physics-driven 3D Microduck that lives on your desktop and reacts to your AI coding agents — Claude Code, Codex CLI, Pi and opencode. Thinking when you prompt, walking when tools run, quacking at you when an agent needs approval, sulking on errors, sleeping when you step away.

> AGPL-3.0 derivative of [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) (baseline `5ca26b5c`). The duck is the official Pollen Robotics Microduck simulator rig, MuJoCo physics and RL walking policies, not pre-baked animation. See `NOTICE.md`.

## Demo

![Duck on Desk: skins, roller skates and stilts on the desktop](docs/media/demo.gif)

[Full demo with sound (80 s, MP4)](https://github.com/Happenmass/duck-on-desk/releases/download/v0.1.0/duck-on-desk-demo.mp4)

## Install

Prebuilt apps are on the [Releases](https://github.com/Happenmass/duck-on-desk/releases) page:

- **macOS**: `Duck-on-Desk-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel). The build is unsigned, so after dragging it to Applications run once:
  `xattr -dr com.apple.quarantine "/Applications/Duck on Desk.app"`
- **Windows**: `Duck-on-Desk-Setup-<version>-x64.exe` or `-arm64.exe` (SmartScreen: More info → Run anyway).

Everything the duck needs is inside the app, including the RL policies (see `NOTICE.md` for their sources); nothing is downloaded at runtime. Launch, open the tray menu → Settings → Agents, and install the hooks for Claude Code, Codex, Pi or opencode.

## Roller skates

The tray menu's **Locomotion** entry switches the duck between its feet and the
official roller-skate variant: the shipped `BEST_roller` policy drives four
passive wheels (push, coast, brake) and `BEST_roller_crouch` is its crouch-glide
trick, which the duck performs whenever it would otherwise peck. Both policies
ship with the app like the walking ones. The policy was
trained without a turning demand, so on skates the duck is steered by rotating
its body directly, inside a wider ±80° camera-facing cone; a little bearing drag
on the wheels keeps the glide at a desktop pace. It cannot sit, and free roam
slides the window by the distance actually rolled.

## Stilts (experimental)

The tray menu's **Stilts** entry puts the duck on the community stilt policies
(`HannesVonEssen/microduck-stilts`, trained in `Vottivott/microduck-playground`).
They ship with the app too (Apache-2.0).

Heights 10–25 cm are the printable ones; 50 cm–2 m are simulation-only. On
stilts the duck walks and turns but does not sit, peck or get up on its own
(a fallen duck is stood back up), and the servo gains are doubled: like every Microduck policy they were trained
against the BAM servo model, and unlike the official ones they do not tolerate
the plain MJCF position actuators this simulator runs.

## Agents
| Agent | Integration | States | Permission bubble |
|---|---|---|---|
| Claude Code | command hooks in `~/.claude/settings.json` + HTTP `PermissionRequest` hook | all | yes |
| Codex CLI | official hooks in `~/.codex/hooks.json`, JSONL polling fallback | all | yes |
| opencode | plugin in `~/.config/opencode/` | all | yes (bridge) |
| Pi | global extension in `~/.pi/agent/extensions/duck-on-desk` | state-only | no (by design) |

## How states become duck behaviour
See `docs/guides/state-mapping.md`.

## Skins
Tray → Skin: Cream, Graphite, Lavender, Sky (the four real Microduck colourways). Voices follow the skin.

## Development
`npm ci && npm run setup:models && npm start` (`setup:models` fetches the policies into your Hugging Face cache once) · `npm test` · `npm run build:mac` / `npm run build:win:all`

## Acknowledgements

- [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) by rullerzhou-afk and contributors (AGPL-3.0): the desktop-pet shell, agent integrations, permission bubbles and settings this project is derived from (baseline commit `5ca26b5c`).
- [Microduck](https://github.com/pollen-robotics/microduck) by Pollen Robotics (Apache-2.0): the tiny biped duck robot itself; [microduck_rl](https://github.com/pollen-robotics/microduck_rl): the RL training environments behind the walking, sitting, ground-pick and roller policies; and the [Microduck simulator Space](https://huggingface.co/spaces/pollen-robotics/microduck-simulator): the 3D rig, MJCF, voices and the policies this duck runs (3D assets and voices are non-commercial, see `NOTICE.md`).
- [microduck-playground](https://github.com/Vottivott/microduck-playground) by Vottivott (Apache-2.0) and the [microduck-stilts](https://huggingface.co/HannesVonEssen/microduck-stilts) weights by HannesVonEssen: the community stilt training and policies.
- Footsteps and thumps are CC0 samples by [Kenney](https://kenney.nl); the notification sound is CC0 by iut_Paris8 on freesound; agent icons come from [LobeHub Icons](https://lobehub.com/icons).
- The demo video's music is "Fluffing a Duck" by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## License
AGPL-3.0-only for code. 3D assets and voice banks are non-commercial (see `NOTICE.md`).
