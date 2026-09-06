# v0.2.0

Adds Reachy Mini as a second robot: a physical Reachy Mini on the LAN, a 3D virtual one on the desktop, or both mirrored.

- Physical Reachy Mini support: mDNS or manual host discovery, auto-connect, and a "Robot" section in Settings and the tray menu
- Robot wake/sleep is driven by the semantic state machine and calls the official daemon moves (`wake_up`, `goto_sleep`), with motor torque re-armed on wake and no retry of an unacknowledged physical move
- Robot volume is mapped to the hardware's dB-linear scale, fixing a bug where any non-maximum volume made the robot inaudible; the official cue sounds are uploaded to the robot
- State-driven physical expressions replay the official recorded emotion and dance libraries through a hardware-screened whitelist, plus continuous liveliness (breathing, antenna sway, head glances with lagged body-yaw follow)
- "Robot motion" menu toggle turns physical expressions and liveliness off without disconnecting
- Virtual Reachy Mini in the 3D renderer, with the official rig, Draco decoder and Apache-2.0 cue sounds bundled offline; the renderer mirrors the physical robot's reported pose when one is connected
- Renderer now reads the current pet prefs on every reload, so switching robots never restores stale settings
- Source layout split into `src/state/`, `src/shell/`, `src/robots/duck/` and `src/robots/reachy/`, with a guard test that every `__dirname` path literal under `src/` resolves
- New guides: `docs/guides/reachy-mini.md` and the 2026-09-06 Reachy control audit; NOTICE credits the Pollen Robotics assets

macOS (arm64/x64 dmg+zip) and Windows (x64/arm64 NSIS).

**Full Changelog**: https://github.com/Happenmass/duck-on-desk/compare/v0.1.1...v0.2.0
