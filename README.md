# Duck on Desk

A physics-driven 3D Microduck that lives on your desktop and reacts to your AI coding agents — Claude Code, Codex CLI, Pi and opencode. Thinking when you prompt, walking when tools run, quacking at you when an agent needs approval, sulking on errors, sleeping when you step away.

> AGPL-3.0 derivative of [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) (baseline `5ca26b5c`). The duck is the official Pollen Robotics Microduck simulator rig, MuJoCo physics and RL walking policies, not pre-baked animation. See `NOTICE.md`.

## Install
See `docs/guides/install.md`. macOS (arm64/x64) and Windows (x64/arm64).

## Roller skates

The tray menu's **Locomotion** entry switches the duck between its feet and the
official roller-skate variant: the shipped `BEST_roller` policy drives four
passive wheels (push, coast, brake) and `BEST_roller_crouch` is its crouch-glide
trick, which the duck performs whenever it would otherwise peck. Both policies
are read from the same Hugging Face cache as the walking ones. The policy was
trained without a turning demand, so on skates the duck is steered by rotating
its body directly (it still keeps to the same camera-facing cone as on foot); it
cannot sit, and free roam slides the window by the distance actually rolled.

## Stilts (experimental)

The tray menu's **Stilts** entry puts the duck on the community stilt policies
(`HannesVonEssen/microduck-stilts`, trained in `Vottivott/microduck-playground`).
Like the official policies they are read from your Hugging Face cache, never
bundled: fetch them once with

```bash
python3 -c "from huggingface_hub import snapshot_download; snapshot_download('HannesVonEssen/microduck-stilts', allow_patterns=['*.onnx', '*.json', '*.md'])"
```

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
`npm ci && npm run setup:models && npm start` · `npm test` · `npm run build:mac` / `npm run build:win:all`

## License
AGPL-3.0-only for code. 3D assets and voice banks are non-commercial (see `NOTICE.md`).
