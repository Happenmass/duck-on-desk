# Setup Guide

[Back to README](../../README.md)

## Source Development Prerequisites

Use Node.js 24.18.0 (the repository `.nvmrc`) for installs, tests, and local
launches. Electron's maintained installer requires Node.js 22.12.0 or newer.

Node 24.16.x and 24.17.x have a known stream compatibility regression that can
silently truncate ZIP extraction when an older `extract-zip` / `yauzl` chain is
present ([nodejs/node#63487](https://github.com/nodejs/node/issues/63487)). The
current Electron dependency no longer uses that chain, but 24.18.0 is the
supported development baseline for the repository and for adjacent tooling.

If Electron reports a missing Framework or the integrity check fails, remove
the whole package and reinstall; do not create only `path.txt`:

```bash
rm -rf node_modules/electron
npm install
```

PowerShell equivalent:

```powershell
Remove-Item -Recurse -Force node_modules/electron
npm install
```

For custom development distributions, a Linux launch with
`ELECTRON_OVERRIDE_DIST_PATH` mirrors Electron's resolver and falls back to the
`electron` executable at the override root when `path.txt` is absent. macOS and
Windows overrides must retain Electron's exact standard `path.txt` because
their supported executable layouts use an app bundle and `electron.exe` rather
than the Linux root executable.

## Agent Setup

Fresh installs enable and install only Claude Code and Codex by default. For other local agents, open **Settings → Agents** and click **Install** for that agent first; after that, Duck keeps the hook/plugin/extension synced on launch while the agent remains enabled. Turning an enabled agent off stops event intake but does not uninstall files. **Uninstall** removes only Duck-managed hook/plugin/extension entries and also disables that agent.

**Custom HTTP agents** — Settings can register another local executable and assign it a stable `custom-...` ID, but registration does not install a hook or make the application report events automatically. Custom agents are state-only in v1: the application or an adapter must POST lifecycle events to Duck's runtime `/state` endpoint, and permission decisions stay in the application's own UI. See [custom-agent-http.md](custom-agent-http.md) for dynamic port discovery, payloads, platform examples, and removal/disable behavior.

**Claude Code** — works out of the box. Hooks are auto-registered on launch. Versioned hooks (`PreCompact`, `PostCompact`, `StopFailure`) are registered only when Duck can positively detect a compatible Claude Code version; if detection fails (common for packaged macOS launches), Duck falls back to core hooks and removes stale incompatible versioned hooks automatically. Beyond watching the directory `~/.claude/settings.json` lives in, Duck also runs a read-only health check every 5 minutes — this catches the hook script being deleted from somewhere like a system Temp folder even when `settings.json` itself never changes. If the same problem fails to auto-repair 3 times in a row, Duck stops retrying automatically and Doctor will prompt for a manual Fix; if the currently-installed hook script itself is missing (a broken install), Duck won't blindly rewrite the config — it'll prompt you to reinstall or re-extract instead.

### Claude Code usage: official status line, not scraping

Local Claude usage collection is **off by default**. You can opt in under **Settings → General → Quota ring → Collect local Claude usage**. Enabling it adds Duck's visible `statusLine.command` to `~/.claude/settings.json`.

This uses Claude Code's documented extension mechanism, not a private or reverse-engineered endpoint. Claude Code's [official status-line documentation](https://code.claude.com/docs/en/statusline) provides `context_window.current_usage`, `context_window.context_window_size`, and (when available) `rate_limits` in the JSON sent to a status-line command. It also states that the command runs locally without consuming API tokens.

The data path is:

1. After a normal Claude Code interaction, Claude Code itself sends its documented status-line JSON to the configured command over stdin.
2. Duck reads the reported input-token usage and context-window size, plus subscription quota when Claude Code supplies it, and renders a short, visible terminal status line.
3. Duck sends the normalized context snapshot and available quota only to its own loopback service at `127.0.0.1:24333-24337`.

For this feature, Duck does **not** make an additional request to Anthropic, scrape `claude.ai`, invoke `/usage`, or read Claude authentication cookies/tokens. It forwards only normalized token counts/window size and available quota percentages/reset times—not prompt or transcript content. Quota availability still follows Claude Code's contract: `rate_limits` may be absent even though context-window data is present.

Duck is only a viewer of values reported by Claude Code. It does not calculate, change, bypass, or enforce Anthropic subscription limits. If a quota window is absent, delayed, or changes semantics upstream, Duck can only omit or display the data Claude Code supplied; it is not the source of the account limit.

#### Model-scoped Claude quota (for example Fable)

Claude may enforce a model-scoped weekly limit in addition to the general 5-hour and weekly limits. For example, Anthropic documents that eligible Max and premium-seat subscriptions can use Fable up to a model-specific portion of the account's weekly allowance and can track both values in Claude's own Usage settings. This is analogous at the product level to a separately identified model quota, but it is not currently exposed through the same integration surface Duck uses.

As of August 15, 2026, Claude Code's documented status-line contract exposes only `rate_limits.five_hour` and `rate_limits.seven_day`. During investigation we observed Claude Code's internal local cache representing Fable as a `weekly_scoped` item under `cachedUsageUtilization.utilization.limits`, and the official client itself uses an internal `/api/oauth/usage` request to obtain richer usage data. Neither that cache schema nor that endpoint is documented as a stable third-party integration contract.

Duck therefore intentionally does **not** read Claude Code's internal usage cache, read or refresh Claude OAuth credentials, or call the undocumented usage endpoint. Consequently, a Fable/model-scoped limit can appear in Claude's own Usage settings without appearing in Duck. This is an upstream visibility boundary, not a failure to parse the documented `rate_limits` object: adding another display provider would not help unless a supported source supplies the additional bucket.

Technical feasibility is not treated as platform support. Duck will reconsider model-scoped Claude quota when Anthropic exposes it through the documented status-line payload, documents a read-only third-party usage interface, or otherwise explicitly supports that integration. Until then, missing Fable quota is expected behavior. See Anthropic's [Fable plan explanation](https://support.claude.com/en/articles/15424964-claude-fable-5-on-your-plan) and Claude Code's [official status-line schema](https://code.claude.com/docs/en/statusline).

The status line is visible and Claude Code provides a single user-level slot. Duck therefore never silently replaces an existing custom local status line: enabling collection fails safely and leaves the existing command unchanged. Turning collection off removes only a command carrying Duck's ownership marker and immediately clears cached local Claude quota, while preserving every non-Claude provider.

Without the Duck statusline, ordinary Claude hooks still report transcript input-token usage. Duck uses a closed list of known stock Claude IDs for a compatibility denominator; an empty, custom, or unknown model ID shows used tokens with an unknown limit instead of guessing 200K. For a custom provider's reported window to match Claude Code's `/context`, enable the usage statusline so Claude Code's own `context_window_size` becomes authoritative while transcript hooks continue refreshing the used count.

Running `npm run install:claude-hooks` for a local hook repair does not opt in. The explicit debug form `npm run install:claude-hooks -- --statusline` can install and display Duck's statusline, but the app still discards its local context/quota POSTs while the Settings switch is off; the next local startup reconcile also removes that Duck-managed debug slot.

**Codex CLI** — works out of the box. Duck auto-registers official Codex hooks in `~/.codex/hooks.json` when Codex is installed, and enables `[features].hooks = true` unless the user explicitly set hooks to `false`. The installer migrates the deprecated `[features].codex_hooks` key to `hooks` while preserving an explicit false value. Local installs use stable platform entries under `~/.codex/duck-hooks/`: Windows reads a managed UTF-8/Base64 data sidecar inside Codex's existing PowerShell command process (with a separate JSON health manifest for Doctor), while POSIX uses a small `/bin/sh` wrapper plus manifest. No unsigned `.ps1` is executed. Codex therefore needs one review for the initial install or migration but does not ask again merely because Duck, its development worktree, or its Node executable changed. Windows and WSL keep separate execution targets when they share `CODEX_HOME`. The official hook path gives live state updates plus real Allow/Deny permission bubbles. **Settings → Agents → Codex → Start with Codex** separately controls whether a local Codex `SessionStart` may cold-launch Duck; turning it off keeps state and approval integration available whenever Duck is already running. Fresh installs default this switch off, while upgrades preserve the prior on behavior. WSL hooks never cold-launch the desktop app. JSONL polling of `~/.codex/sessions/` remains as a state/metadata fallback for hook-disabled sessions and events Codex hooks do not cover; approval prompts are no longer inferred from JSONL. Codex `request_user_input` calls are detected from that transcript stream: Duck plays the notification reaction and shows a read-only preview of the questions/options. Answer in Codex itself; the card never injects a choice and closes when the matching tool output is recorded.

**CodeBuddy** — uses Claude Code-compatible hooks in `~/.codebuddy/settings.json`. Install it from **Settings → Agents** when you want local CodeBuddy tracking; after that Duck keeps the hooks synced on launch while CodeBuddy remains enabled. The PermissionRequest entry uses the versioned marker `duck-on-desk.permission.v1`; registration and uninstall leave unrelated HTTP hooks—including a third-party hook named only `duck`—untouched. Bare `node hooks/codebuddy-install.js` preserves an existing marker-owned custom permission URL. Use `--permission-url local` to explicitly restore the local Duck endpoint, or `--permission-url https://example/permission` to explicitly set a custom HTTP(S) endpoint.

**WorkBuddy** — uses Claude Code-compatible hooks in `~/.workbuddy-ai/settings.json` (current WorkBuddy AI) or `~/.workbuddy/settings.json` (legacy builds). Install it from **Settings → Agents** when you want local WorkBuddy tracking; after that Duck keeps the hooks synced on launch while WorkBuddy remains enabled. You can also run `node hooks/workbuddy-install.js` manually. WorkBuddy is a macOS/Windows Electron desktop app with no standalone Linux/WSL CLI; state-driven animations have been verified on macOS. Integration is **state + Notification only**: the desktop app always handles permission approval inside its own native sandbox and GUI confirmation cards, so Duck never registers a `/permission` HTTP hook. A permission prompt reaches Duck only as a waiting-for-confirmation Notification carrying its `session_id` — the bell/attention cue works (verified on Windows), but the approve/deny decision stays inside WorkBuddy.

**opencode** — uses the effective plugin config under `~/.config/opencode/`: `config.json` → `opencode.json` → `opencode.jsonc`, with the later file winning. Install it from **Settings → Agents** when you want local opencode tracking; after that Duck keeps the plugin synced on launch while opencode remains enabled. You can also run `node hooks/opencode-install.js` manually.

**Pi** — uses a global extension directory at `~/.pi/agent/extensions/duck-on-desk`. Install it from **Settings → Agents** when you want local Pi tracking; after that Duck keeps the extension synced on launch while Pi remains enabled. You can also run `npm run install:pi-extension` manually. Interactive Pi sessions report lifecycle and tool activity to Duck, but Pi is state-only: Duck does not show permission bubbles, does not call Pi terminal confirmation, and preserves Pi's default YOLO execution behavior.

## Permission handling automation

Use the pet or tray **Permission handling** submenu to choose how Duck handles supported permission requests:

- **Ask every time** makes no automatic decisions.
- **Question prompts only** automatically approves tool-shaped requests from explicitly supported agents, while questions and plan reviews still wait for you. Claude uses a reviewed built-in list, but not every supported adapter applies a per-tool allowlist.
- **Auto-approve** handles every request the adapter marks automation-eligible. For Claude this includes unrecognized non-empty request names; missing names, unsupported decision shapes, and CodeBuddy questions/plans still defer to the native flow. Use it only if you are comfortable delegating this broader set of decisions. After an app restart, this mode downgrades to **Question prompts only**.

Both automation modes are confirmation-gated. The Dashboard can independently set each eligible live session to **Ask every time** or the tools-only mode. New agents do not become eligible merely because they expose permission support, but tool-name handling remains adapter- and mode-specific as described above. State-only integrations and agents that own a native permission flow continue to use that native flow.

## WSL (Windows Subsystem for Linux)

If an agent runs inside WSL while Duck runs on the Windows host, its integration posts to `127.0.0.1:24333-24337`. WSL1 shares that loopback. WSL2 normally needs mirrored networking; default NAT does not make the Windows loopback server reachable from Linux. The in-app Pair flow probes this path and warns when installation succeeded but connectivity did not.

For supported agents, open **Settings → Agents**, use **WSL Scan** from the Connected section, then find the matching distro row and choose **Pair**. A WSL-only agent can remain under the **Unavailable** collapsible section because local installation status and WSL pairing are separate. Pairing enables Duck's event ingress but does not mark or install a Windows-local integration.

**Setup:**

```bash
# Inside your WSL shell:
mkdir -p ~/.claude/hooks

# Copy hook files from the Windows-side repo (adjust the /mnt/ path to your Duck location)
cp /mnt/d/animation/hooks/{server-config,json-utils,shared-process,duck-hook,install,codex-hook,codex-install,codex-install-utils,codex-session-index,codex-subagent-fields}.js ~/.claude/hooks/

# Register Claude hooks in remote mode
node ~/.claude/hooks/install.js --remote

# Register Codex official hooks in remote mode when Codex CLI is installed in WSL
node ~/.claude/hooks/codex-install.js --remote
```

After setup, start Duck on Windows and run Claude Code in WSL — Duck reacts to your sessions automatically. Permission bubbles work too.

The in-app WSL deploy path intentionally runs the Claude installer without `--statusline`, so it provides transcript fallback only and does not claim an authoritative custom-provider window. The manual `--remote` command above does install a visible statusline in WSL's separate home, but the Windows app accepts its context/quota metadata only while **Collect local Claude usage** is enabled. With the switch off, those POSTs are successful no-ops. Windows startup reconciliation cannot remove a statusline from WSL's separate home.

For Codex in WSL, official hooks work when Codex runs inside the WSL environment and `~/.codex` exists there. If you prefer sharing the Windows Codex home, set `CODEX_HOME=/mnt/c/Users/<windows-user>/.codex` inside WSL before running Codex.

### WSL Networking & Hook Registration (Alternative Approach)

Duck runs as a Windows Electron app, while your AI coding agents (Claude Code, Codex CLI, etc.) may run inside WSL. Hook scripts in WSL POST HTTP requests to `127.0.0.1:24333`, so WSL and Windows must share the same localhost.

- **WSL1** — works out of the box. WSL1 naturally shares localhost with Windows, no extra configuration needed.
- **WSL2** — requires mirrored networking mode. WSL2 has its own network stack by default, so `127.0.0.1` points to WSL itself, not Windows. Enable mirrored mode in `%USERPROFILE%\.wslconfig` (create the file if it doesn't exist), then run `wsl --shutdown` to restart WSL:

```ini
[wsl2]
networkingMode=mirrored
```

**Manually register hooks inside WSL:**

Duck auto-registers Claude Code hooks to `~/.claude/settings.json` on Windows startup. But if your agent runs in WSL, hooks need to be registered in WSL's own home directory. Run inside WSL:

```bash
git clone https://github.com/rullerzhou-afk/duck-on-desk.git
cd duck-on-desk

# Claude Code
node hooks/install.js

# Codex CLI
node hooks/codex-install.js --remote

# CodeBuddy
# Preserves an existing marker-owned custom permission URL.
node hooks/codebuddy-install.js
# Explicit alternatives:
# node hooks/codebuddy-install.js --permission-url local
# node hooks/codebuddy-install.js --permission-url https://approval.example/permission

# WorkBuddy
node hooks/workbuddy-install.js

# opencode
node hooks/opencode-install.js

# Pi
node hooks/pi-install.js
```

> **Tip:** If the repo is cloned inside WSL (e.g. `~/duck-on-desk`), hook scripts will automatically use WSL's Node.js path. If the repo is on a Windows drive (e.g. `/mnt/c/...`), make sure `node` is in WSL's `PATH`.

## Windows Notes

- **Installer**: GitHub Releases provide separate NSIS installers for Windows x64 and Windows ARM64. Use `Duck-on-Desk-Setup-<version>-x64.exe` on Intel/AMD Windows, and `Duck-on-Desk-Setup-<version>-arm64.exe` on Windows on ARM.
- **Auto-update**: packaged Windows installs use `electron-updater`; updates keep the matching architecture.

## macOS Notes

- **From source** (`npm start`): works out of the box on Intel and Apple Silicon.
- **Official DMG installers**: official GitHub Releases provide both x64 and arm64 DMGs. The release workflow signs them with Developer ID, notarizes them with Apple, and staples the notarization ticket. A manual `workflow_dispatch` run without signing credentials may produce only ad-hoc validation artifacts; those are not official distribution packages.
- **Auto-update bridge**: older DMG releases do not include ZIP update payloads, so they cannot update themselves directly to the first release with in-app updates. Existing users must manually install that bridge release from GitHub Releases once. Afterward, official releases can be downloaded inside Duck and installed either with **Restart Now**, or with **Later** followed by quitting and reopening the app. The capability is not considered verified until an A→B upgrade signed with the same Developer ID succeeds on real hardware; unit tests are not a substitute.
- **Source auto-update**: when running from a cloned repo, "Check for Updates" performs `git pull` + `npm install` (if dependencies changed) and restarts the app automatically.

## Linux Notes

- **From source** (`npm start`): the Electron sandbox is enabled by default. If your Linux dev environment still fails chrome-sandbox initialization, use `DUCK_DISABLE_SANDBOX=1 npm start` as a temporary workaround.
- **Packages**: AppImage and `.deb` are available from [GitHub Releases](https://github.com/rullerzhou-afk/duck-on-desk/releases). After deb install, the app icon appears in GNOME's app menu.
- **Terminal focus**: uses `wmctrl` or `xdotool` (whichever is available). Install one for session terminal jumping to work: `sudo apt install wmctrl` or `sudo apt install xdotool`.
- **Auto-update**: AppImage and deb installs must still be downloaded manually from GitHub Releases. When running from a cloned repo, "Check for Updates" performs `git pull` + `npm install` (if dependencies changed) and restarts the app automatically.
