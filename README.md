# Duck on Desk

A physics-driven 3D Microduck that lives on your desktop and reacts to your AI coding agents — Claude Code, Codex CLI, Pi and opencode. Thinking when you prompt, walking when tools run, quacking at you when an agent needs approval, sulking on errors, sleeping when you step away.

> AGPL-3.0 derivative of [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) (baseline `5ca26b5c`). The duck is the official Pollen Robotics Microduck simulator rig, MuJoCo physics and RL walking policies, not pre-baked animation. See `NOTICE.md`.

## Install
See `docs/guides/install.md`. macOS (arm64/x64) and Windows (x64/arm64).

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
