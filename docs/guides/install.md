# Install

Prebuilt apps are published on the [Releases](https://github.com/Happenmass/duck-on-desk/releases) page by the tag build (`.github/workflows/build.yml`). The RL policies are not bundled: fetch them once into your Hugging Face cache (step 3 below).

## macOS
1. Download `Duck-on-Desk-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from Releases.
2. Drag "Duck on Desk" to Applications. The build is unsigned: run `xattr -dr com.apple.quarantine "/Applications/Duck on Desk.app"` once.
3. Policies (six ONNX files, ~0.8 MB each):

```bash
DIR="$HOME/.cache/huggingface/microduck-simulator/183f99a40bd7308da3e848de961ed32bb02624a5/policies"
mkdir -p "$DIR"
for f in BEST_alpha_walking BEST_alpha_sitstand BEST_alpha_stand alpha_ground_pick BEST_roller BEST_roller_crouch; do
  curl -L -o "$DIR/$f.onnx" "https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/183f99a40bd7308da3e848de961ed32bb02624a5/app/public/policies/$f.onnx"
done
```

4. Launch. Open the tray menu → Settings → Agents to install hooks for Claude Code, Codex, Pi or opencode.

## Windows
1. Download `Duck-on-Desk-Setup-<version>-x64.exe` or `-arm64.exe`.
2. Run the installer (SmartScreen: More info → Run anyway; the build is unsigned).
3. Policies (PowerShell):

```powershell
$dir = "$env:USERPROFILE\.cache\huggingface\microduck-simulator\183f99a40bd7308da3e848de961ed32bb02624a5\policies"
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($f in "BEST_alpha_walking","BEST_alpha_sitstand","BEST_alpha_stand","alpha_ground_pick","BEST_roller","BEST_roller_crouch") {
  Invoke-WebRequest "https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/183f99a40bd7308da3e848de961ed32bb02624a5/app/public/policies/$f.onnx" -OutFile "$dir\$f.onnx"
}
```

4. Launch and install agent hooks from Settings → Agents.

## From source
`npm ci && npm run setup:models && npm start` — `setup:models` links the cache directory above into `models/policies`, so fetch the files first.
