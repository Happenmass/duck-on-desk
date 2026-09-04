# State Mapping

[Back to README](../../README.md)

Most lifecycle events from agents (Claude Code hooks, Codex JSONL) map to the same animation states.

Subagent events still map to the logical `juggling` state, but Duck now chooses a tiered asset by live subagent count: 1 subagent uses `duck-headphones-groove.svg`, while 2+ subagents use `duck-working-juggling.svg`. The old Duck conducting asset is retired; Calico and Cloudling still use their conducting animations for their 2+ subagent tier.

The idle rows below describe the theme's stock behavior. Settings → Animation & Sound → Animations can instead choose any idle visual declared by the active theme as its persistent resting look. This changes only the visual shown while the logical state is `idle`: task, permission, completion, sleep, reaction, and roam states still take precedence and return to the selected look afterward. The choice is stored per theme and falls back to the theme default if the file disappears. Non-default idle visuals intentionally do not use cursor eye tracking or spin-to-dizzy.

Duck also has a conditional Outlaw idle easter egg: while both the Western cowboy hat and cigarette are selected, an eligible ordinary idle roll has a 50% chance to play `duck-outlaw-bender.svg`, with a 30-minute cooldown. Hidden, low-power, mini, roaming, dragging, menu-open, and non-idle periods do not consume the roll or cooldown. The animation embeds its own hat and cigarette, so the two external accessory layers are hidden only for that file.

| Agent Event | State | Animation | Duck | Calico | Cloudling |
|---|---|---|---|---|---|
| Idle (no activity) | idle | Eye-tracking follow | <img src="../../assets/gif/duck-idle.gif" width="160"> | <img src="../../assets/gif/calico-idle.gif" width="130"> | <img src="../../assets/gif/cloudling-idle.gif" width="140"> |
| Idle (random) | idle | Reading / patrol | <img src="../../assets/gif/duck-idle-reading.gif" width="160"> | | <img src="../../assets/gif/cloudling-idle-reading.gif" width="140"> |
| UserPromptSubmit | thinking | Thought bubble + spark | <img src="../../assets/gif/duck-thinking.gif" width="160"> | <img src="../../assets/gif/calico-thinking.gif" width="130"> | <img src="../../assets/gif/cloudling-thinking.gif" width="140"> |
| PreToolUse / PostToolUse (1 session) | working (typing) | Typing | <img src="../../assets/gif/duck-typing.gif" width="160"> | <img src="../../assets/gif/calico-typing.gif" width="130"> | <img src="../../assets/gif/cloudling-typing.gif" width="140"> |
| PreToolUse / PostToolUse (2 sessions) | working (2-session tier) | Headphones groove | <img src="../../assets/gif/duck-headphones-groove.gif" width="160"> | <img src="../../assets/gif/calico-juggling.gif" width="130"> | <img src="../../assets/gif/cloudling-juggling.gif" width="140"> |
| PreToolUse (3+ sessions) | working (building) | Building | <img src="../../assets/gif/duck-building.gif" width="160"> | <img src="../../assets/gif/calico-building.gif" width="130"> | <img src="../../assets/gif/cloudling-building.gif" width="140"> |
| SubagentStart (1 live subagent) | juggling | Headphones groove | <img src="../../assets/gif/duck-headphones-groove.gif" width="160"> | <img src="../../assets/gif/calico-juggling.gif" width="130"> | <img src="../../assets/gif/cloudling-juggling.gif" width="140"> |
| SubagentStart (2+ live subagents) | juggling (2+ tier) | Three-ball juggling | <img src="../../assets/gif/duck-juggling.gif" width="160"> | <img src="../../assets/gif/calico-conducting.gif" width="130"> | <img src="../../assets/gif/cloudling-conducting.gif" width="140"> |
| PostToolUseFailure | error | Error | <img src="../../assets/gif/duck-error.gif" width="160"> | <img src="../../assets/gif/calico-error.gif" width="130"> | <img src="../../assets/gif/cloudling-error.gif" width="140"> |
| Stop / PostCompact | attention | Happy | <img src="../../assets/gif/duck-happy.gif" width="160"> | <img src="../../assets/gif/calico-happy.gif" width="130"> | <img src="../../assets/gif/cloudling-attention.gif" width="140"> |
| PermissionRequest | notification | Alert | <img src="../../assets/gif/duck-notification.gif" width="160"> | <img src="../../assets/gif/calico-notification.gif" width="130"> | <img src="../../assets/gif/cloudling-notification.gif" width="140"> |
| Codex `request_user_input` | notification | Alert + read-only question card | <img src="../../assets/gif/duck-notification.gif" width="160"> | <img src="../../assets/gif/calico-notification.gif" width="130"> | <img src="../../assets/gif/cloudling-notification.gif" width="140"> |
| PreCompact | sweeping | Sweeping | <img src="../../assets/gif/duck-sweeping.gif" width="160"> | <img src="../../assets/gif/calico-sweeping.gif" width="130"> | <img src="../../assets/gif/cloudling-sweeping.gif" width="140"> |
| WorktreeCreate | carrying | Carrying | <img src="../../assets/gif/duck-carrying.gif" width="160"> | <img src="../../assets/gif/calico-carrying.gif" width="130"> | <img src="../../assets/gif/cloudling-carrying.gif" width="140"> |
| 60s mouse idle | sleeping | Sleep | <img src="../../assets/gif/duck-sleeping.gif" width="160"> | <img src="../../assets/gif/calico-sleeping.gif" width="130"> | <img src="../../assets/gif/cloudling-sleeping.gif" width="140"> |
| SessionEnd | remove session; idle if no live sessions | No sleep transition | | | |

## Pi Extension Events

Pi uses a global extension (`~/.pi/agent/extensions/duck-on-desk`) and maps interactive-session lifecycle events to shared Duck states:

| Pi Extension Event | Duck Event | State |
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

## Mini Mode

Drag to the right screen edge (or right-click → "Mini Mode") to enter mini mode — half-body visible at screen edge, peeking out on hover.

| Trigger | Mini Reaction | Duck | Calico | Cloudling |
|---|---|---|---|---|
| Default | Breathing + blinking + eye tracking | <img src="../../assets/gif/duck-mini-idle.gif" width="100"> | <img src="../../assets/gif/calico-mini-idle.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-idle.gif" width="90"> |
| Hover | Peek out + wave | <img src="../../assets/gif/duck-mini-peek.gif" width="100"> | <img src="../../assets/gif/calico-mini-peek.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-peek.gif" width="90"> |
| Notification | Alert pop | <img src="../../assets/gif/duck-mini-alert.gif" width="100"> | <img src="../../assets/gif/calico-mini-alert.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-alert.gif" width="90"> |
| Task complete | Happy celebration | <img src="../../assets/gif/duck-mini-happy.gif" width="100"> | <img src="../../assets/gif/calico-mini-happy.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-happy.gif" width="90"> |

## Click Reactions

Easter eggs — try double-clicking, rapid 4-clicks, or poking Duck repeatedly to discover hidden reactions.
