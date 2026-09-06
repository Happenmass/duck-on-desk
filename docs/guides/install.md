# Install

Prebuilt apps are published on the [Releases](https://github.com/Happenmass/duck-on-desk/releases) page by the tag build (`.github/workflows/build.yml`). The RL policies (official Microduck simulator policies and the community stilt policies) are bundled under `resources/policies/`; nothing is downloaded at runtime. If a matching Hugging Face cache exists (`~/.cache/huggingface/microduck-simulator/<commit>/policies/`, `~/.cache/huggingface/hub/models--HannesVonEssen--microduck-stilts/`), the app reads from it first.

## macOS
1. Download `Duck-on-Desk-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from Releases.
2. Drag "Duck on Desk" to Applications. The build is unsigned: run `xattr -dr com.apple.quarantine "/Applications/Duck on Desk.app"` once.
3. Launch. Open the tray menu → Settings → Agents to install hooks for Claude Code, Codex, Pi or opencode.

## Windows
1. Download `Duck-on-Desk-Setup-<version>-x64.exe` or `-arm64.exe`.
2. Run the installer (SmartScreen: More info → Run anyway; the build is unsigned).
3. Launch and install agent hooks from Settings → Agents.

## From source
`npm ci && npm run setup:models && npm start` — `setup:models` runs `scripts/fetch-policies.js`, which fills your Hugging Face cache with the pinned policies (skipping what is already there), stages copies in `models/bundled/` for packaging, and links the cache into `models/policies`. `npm run build:mac` / `build:win:all` run it again before packaging.
