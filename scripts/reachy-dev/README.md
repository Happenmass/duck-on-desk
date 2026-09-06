# Reachy Mini dev tooling

Used for the 2026-09-06 end-to-end verification; nothing here ships with the app.

- `fake-reachy-daemon.cjs` — a local stand-in for daemon 1.10.0 (status, motors, wake/sleep,
  recorded moves, volume, sound upload) that logs every call. `node scripts/reachy-dev/fake-reachy-daemon.cjs`
  (port 8765; `FAKE_LOG=` for the log path), then set the app's `reachyHost` to `127.0.0.1:8765`.
- `drive.sh "<expr>"` — evaluates `<expr>` inside `src/main.js` scope of a running dev instance
  launched with `--inspect=9357` and `--remote-debugging-port=9356` (see the header comment).
  Examples: `_state.setState('sleeping')`, `enableDoNotDisturb()`, `robotPowerControl.wake()`,
  `_reachyMini.snapshot()`.
- `main-eval.mjs` / `cdp-eval.mjs` — the inspector helpers `drive.sh` builds on.
