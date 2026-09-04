# Install

## macOS
1. Download `Duck-on-Desk-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from Releases.
2. Drag "Duck on Desk" to Applications. The build is unsigned: run `xattr -dr com.apple.quarantine "/Applications/Duck on Desk.app"` once.
3. Policies: run `npm run setup:models` from a source checkout or copy the four ONNX files into `~/.cache/huggingface/microduck-simulator/183f99a40bd7308da3e848de961ed32bb02624a5/policies/`.
4. Launch. Open the tray menu → Settings → Agents to install hooks for Claude Code, Codex, Pi or opencode.

## Windows
1. Download `Duck-on-Desk-Setup-<version>-x64.exe` or `-arm64.exe`.
2. Run the installer (SmartScreen: More info → Run anyway; the build is unsigned).
3. Policies: copy the four ONNX files into `%USERPROFILE%\.cache\huggingface\microduck-simulator\183f99a40bd7308da3e848de961ed32bb02624a5\policies\`.
4. Launch and install agent hooks from Settings → Agents.
