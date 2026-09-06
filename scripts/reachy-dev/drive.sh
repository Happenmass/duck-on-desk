#!/bin/bash
# Evaluate an expression inside the running app's main.js module scope (dev only).
# Launch the app with the local Electron binary and both inspectors, e.g.
#   ./node_modules/.bin/electron --inspect=9357 . --remote-debugging-port=9356 --user-data-dir=<isolated dir>
# then: scripts/reachy-dev/drive.sh "(_state.setState('notification'), 'sent')"
# The breakpoint sits on the pet-runtime-config IPC handler; a renderer call over CDP fires it.
cd "$(dirname "$0")"
LINE=$(( $(grep -n 'ipcMain.handle("pet-runtime-config"' ../../src/main.js | head -1 | cut -d: -f1) ))
( sleep 1.5; node cdp-eval.mjs "window.electronAPI.getPetRuntimeConfig().then(()=>'ok')" > /dev/null 2>&1 ) &
node main-eval.mjs "$LINE" "$1" 20000 2>&1 | head -c 700; echo
wait
