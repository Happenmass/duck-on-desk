# State Mapping

[Back to README](../../README.md)

Duck's animation is driven by a physics-based 3D renderer (`renderer/`, Vite root, theme id `duck`, `theme.json.renderer = "duck3d"`). Every agent lifecycle event (Claude Code hooks, Codex hooks/JSONL, the opencode plugin, the Pi extension) first resolves to one of a fixed set of logical states; each logical state maps to an intent id in `themes/duck/theme.json`'s `states` table, and `DuckRuntime` turns that intent into a MuJoCo motion/behaviour command through `MotionLeases` (all 3D motion commands use `source: "system"`, priority 90 — higher than autonomous idle roaming at 10, lower than a local user override at 100).

| Logical state | Intent id | Duck behaviour |
|---|---|---|
| idle / dizzy | `duck-idle` | Stand up (or wake) first, then resume the AutonomyAdapter's idle scheduling |
| roam (free roam; the duck moves the window) | `duck-roam` | Walk in side profile toward the side given by main's `roam-heading` (heading ±(90°+tilt), forward 0.45, tilt random within ±0.2 rad per walk). The renderer reports how far the trunk actually walked (screen px, `duck-displacement`) and main moves the window by exactly that, so window motion and gait always agree; the tilt toward/away from the camera becomes a slight downward/upward drift. Main picks the side from the duck's reported facing (the side it already leans to), skips the walk when that side has no room, and ends it once the planned distance is covered or the walk is blocked at an edge |
| thinking | `duck-thinking` | Walk in place facing the camera (heading 0, forward 0.6, re-leased every 1.5s for as long as the state lasts) + a random `look` every 1.5s |
| working | `duck-working` | `move {forward:0.7, heading:0}`, held (2s TTL, re-leased on loop) |
| juggling | `duck-juggling` | `move {forward:0.8, heading:±0.8}`, direction flips every 3s |
| carrying | `duck-carrying` | `perform peck` once |
| sweeping | `duck-sweeping` | `perform peck` every 4s |
| attention | `duck-attention` | `move {heading:0}` for 1.5s + `perform quack` once |
| notification | `duck-notification` | `move {heading:0}` + `perform quack` every 2.5s |
| error | `duck-error` | `perform sit` + `look {headPitch:0.5}` |
| yawning / dozing / collapsing / sleeping | `duck-sleeping` | `sleep` |
| waking | `duck-waking` | `wake` |

When multiple sessions are live, Duck resolves to the state with the highest priority: `error 8 > notification 7 > sweeping 6 > attention 5 > carrying = juggling 4 > working 3 > thinking 2 > idle = roam 1 > sleeping 0`.

## Pi Extension Events

Pi uses a global extension (`~/.pi/agent/extensions/duck-on-desk`) and maps interactive-session lifecycle events to the same logical states above:

| Pi Extension Event | Duck Event | Logical state |
|---|---|---|
| session_start | SessionStart | idle |
| before_agent_start | UserPromptSubmit | thinking |
| tool_call | PreToolUse | working |
| tool_result (ok) | PostToolUse | working |
| tool_result (isError) | PostToolUseFailure | error |
| agent_end | Stop | attention |
| session_before_compact | PreCompact | sweeping |
| session_compact | PostCompact | attention |
| session_shutdown | SessionEnd | remove session; idle if no live sessions |

Pi is state-only in Duck: Duck does not intercept permissions or add confirmation prompts, so Pi keeps its default YOLO execution behavior.
