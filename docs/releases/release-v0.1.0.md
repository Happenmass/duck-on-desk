# v0.1.0

First release of duck-on-desk.

- 3D Microduck renderer (Three.js + MuJoCo WASM + ONNX walking/sit-stand/stand/ground-pick policies)
- Agents: Claude Code, Codex CLI (official hooks + JSONL fallback), Pi (state-only), opencode
- Permission bubbles with Allow/Deny for Claude Code, Codex and opencode
- Skins: Cream, Graphite, Lavender, Sky; voice banks follow the skin; mute toggle
- macOS (arm64/x64 dmg+zip) and Windows (x64/arm64 NSIS)

Derived from Clawd on Desk 5ca26b5c under AGPL-3.0. Policies are read from the user's Hugging Face cache; nothing is bundled.
