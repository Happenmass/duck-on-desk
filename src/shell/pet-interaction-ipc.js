"use strict";

const path = require("path");

function requiredDependency(value, name) {
  if (!value) throw new Error(`registerPetInteractionIpc requires ${name}`);
  return value;
}

function isTrustedMainFrameEvent(event, webContents) {
  if (!event || !webContents || event.sender !== webContents) return false;
  try {
    return !!event.senderFrame && event.senderFrame === webContents.mainFrame;
  } catch {
    return false;
  }
}

function registerPetInteractionIpc(options = {}) {
  const ipcMain = requiredDependency(options.ipcMain, "ipcMain");
  const showContextMenu = requiredDependency(options.showContextMenu, "showContextMenu");
  const moveWindowForDrag = requiredDependency(options.moveWindowForDrag, "moveWindowForDrag");
  const setIdlePaused = requiredDependency(options.setIdlePaused, "setIdlePaused");
  const isMiniTransitioning = requiredDependency(options.isMiniTransitioning, "isMiniTransitioning");
  const getCurrentState = requiredDependency(options.getCurrentState, "getCurrentState");
  const getCurrentSvg = requiredDependency(options.getCurrentSvg, "getCurrentSvg");
  const sendToRenderer = requiredDependency(options.sendToRenderer, "sendToRenderer");
  const requestDragReaction = options.requestDragReaction || null;
  const requestClickReaction = options.requestClickReaction || null;
  const onPetIntent = options.onPetIntent || (() => {});
  const recoverVisiblePetAfterRendererLoad = requiredDependency(
    options.recoverVisiblePetAfterRendererLoad,
    "recoverVisiblePetAfterRendererLoad"
  );
  const setDragLocked = requiredDependency(options.setDragLocked, "setDragLocked");
  const setMouseOverPet = requiredDependency(options.setMouseOverPet, "setMouseOverPet");
  const cancelRoam = requiredDependency(options.cancelRoam, "cancelRoam");
  // duck-on-desk: keeps the hit window under the pointer for the whole
  // middle-button lift (see pet-window-runtime.js); optional for hosts without it.
  const expandHitWindowForLift = options.expandHitWindowForLift || (() => false);
  const beginDragSnapshot = requiredDependency(options.beginDragSnapshot, "beginDragSnapshot");
  const clearDragSnapshot = requiredDependency(options.clearDragSnapshot, "clearDragSnapshot");
  const syncHitWin = requiredDependency(options.syncHitWin, "syncHitWin");
  const isMiniMode = requiredDependency(options.isMiniMode, "isMiniMode");
  const checkMiniModeSnap = requiredDependency(options.checkMiniModeSnap, "checkMiniModeSnap");
  const hasPetWindow = requiredDependency(options.hasPetWindow, "hasPetWindow");
  const getPetWindowBounds = requiredDependency(options.getPetWindowBounds, "getPetWindowBounds");
  const getCurrentPixelSize = requiredDependency(options.getCurrentPixelSize, "getCurrentPixelSize");
  // #408: prefer the effective (frozen, when keepSizeAcrossDisplays) size over
  // re-reading live bounds; falls back to proportional when not provided.
  const getEffectiveCurrentPixelSize = options.getEffectiveCurrentPixelSize || getCurrentPixelSize;
  const computeDragEndBounds = requiredDependency(options.computeDragEndBounds, "computeDragEndBounds");
  const applyPetWindowBounds = requiredDependency(options.applyPetWindowBounds, "applyPetWindowBounds");
  const flushRuntimeStateToPrefs = requiredDependency(
    options.flushRuntimeStateToPrefs,
    "flushRuntimeStateToPrefs"
  );
  const reassertWinTopmost = requiredDependency(options.reassertWinTopmost, "reassertWinTopmost");
  const scheduleHwndRecovery = requiredDependency(options.scheduleHwndRecovery, "scheduleHwndRecovery");
  const repositionFloatingBubbles = requiredDependency(
    options.repositionFloatingBubbles,
    "repositionFloatingBubbles"
  );
  const exitMiniMode = requiredDependency(options.exitMiniMode, "exitMiniMode");
  const getDisableMiniMode = options.getDisableMiniMode || (() => false);
  const getFocusableLocalHudSessionIds = requiredDependency(
    options.getFocusableLocalHudSessionIds,
    "getFocusableLocalHudSessionIds"
  );
  const focusLog = requiredDependency(options.focusLog, "focusLog");
  const showDashboard = requiredDependency(options.showDashboard, "showDashboard");
  const focusSession = requiredDependency(options.focusSession, "focusSession");
  const revealSessionHud = requiredDependency(options.revealSessionHud, "revealSessionHud");
  const setLowPowerIdlePaused = requiredDependency(
    options.setLowPowerIdlePaused,
    "setLowPowerIdlePaused"
  );
  const setAccessoryMirror = options.setAccessoryMirror || (() => {});
  const settleVisual = options.settleVisual || (() => false);
  const syncDisplayedVisualGeometry = options.syncDisplayedVisualGeometry || (() => {});
  // #640: the editing-overlap dodge defers its hit-window click-through write
  // while a drag is in flight; drag-lock release must re-run the sync so the
  // state the drag ended in (overlapping or not) gets applied.
  const syncImeEditingPetDodge = options.syncImeEditingPetDodge || (() => {});
  const statPath = requiredDependency(options.statPath, "statPath");
  const openTerminalAt = requiredDependency(options.openTerminalAt, "openTerminalAt");
  const dropLog = options.dropLog || (() => {});
  const isMacPlatform = options.isMacPlatform != null
    ? !!options.isMacPlatform
    : process.platform === "darwin";
  const disposers = [];

  function on(channel, listener) {
    ipcMain.on(channel, listener);
    disposers.push(() => ipcMain.removeListener(channel, listener));
  }

  on("show-context-menu", showContextMenu);
  on("drag-move", () => moveWindowForDrag());
  on("pet-visual-ready", (event) => {
    recoverVisiblePetAfterRendererLoad(event);
    // duck-on-desk: the 3D renderer only starts listening once MuJoCo and the
    // ONNX policies have loaded, seconds after did-finish-load, so the state
    // main sent on load (startup recovery, a reload mid-session) never reached
    // it and a "working" duck stood still. Send the current visual again now.
    if (isMiniTransitioning()) return;
    sendToRenderer("state-change", getCurrentState(), getCurrentSvg());
  });
  on("pet-visual-settled", (event, payload) => settleVisual(event, payload));

  on("pause-cursor-polling", () => {
    setIdlePaused(true);
  });
  on("resume-from-reaction", () => {
    setIdlePaused(false);
    if (isMiniTransitioning()) return;
    sendToRenderer("state-change", getCurrentState(), getCurrentSvg());
  });
  on("low-power-idle-paused", (_event, paused) => {
    setLowPowerIdlePaused(!!paused);
  });
  // The renderer is the only side that knows whether the accessory ended up
  // mirrored (mini edge flip composed with the asset-direction flip). Hit
  // geometry consumes this instead of predicting it.
  on("accessory-mirror", (_event, mirrored) => {
    setAccessoryMirror(!!mirrored);
  });

  on("drag-lock", (_event, locked) => {
    setDragLocked(!!locked);
    if (locked) {
      setMouseOverPet(true);
      cancelRoam();
      beginDragSnapshot();
    } else {
      clearDragSnapshot();
      syncHitWin();
      syncDisplayedVisualGeometry();
      syncImeEditingPetDodge();
    }
  });

  // duck-on-desk: middle-button pick-up. The hit window holds drag-lock, so
  // each move carries the window under the pointer exactly like a left-button
  // drag; the window's rise above where the duck was picked up becomes its
  // height in the scene (LIFT_PX_PER_METRE px per metre, camera follows). After
  // the release the renderer streams the trunk's height while it falls
  // (duck-fall) and the window rides it back down to the ground line.
  const LIFT_PX_PER_METRE = 250;
  let liftGroundY = null; // window y at pick-up
  let fallGroundY = null; // ground line of the current fall; null = not falling
  on("duck-lift", (_event, payload) => {
    const phase = payload && ["start", "move", "end"].includes(payload.phase) ? payload.phase : null;
    if (!phase) return;
    if (phase === "start") {
      const bounds = getPetWindowBounds();
      liftGroundY = bounds ? bounds.y : null;
      fallGroundY = null;
      expandHitWindowForLift();
      sendToRenderer("duck-lift", { phase, pxPerMetre: LIFT_PX_PER_METRE });
    } else if (phase === "move") {
      moveWindowForDrag();
      const bounds = getPetWindowBounds();
      sendToRenderer("duck-lift", { phase, dy: bounds && liftGroundY !== null ? bounds.y - liftGroundY : 0 });
    } else {
      liftGroundY = null;
      sendToRenderer("duck-lift", { phase });
    }
  });
  on("duck-fall", (_event, payload) => {
    const height = payload && Number.isFinite(payload.height) ? Math.max(0, payload.height) : 0;
    const done = !!(payload && payload.done);
    const bounds = getPetWindowBounds();
    if (!bounds) { fallGroundY = null; return; }
    if (fallGroundY === null) fallGroundY = bounds.y + Math.round(height * LIFT_PX_PER_METRE);
    const y = done ? fallGroundY : fallGroundY - Math.round(height * LIFT_PX_PER_METRE);
    if (y !== bounds.y) {
      applyPetWindowBounds({ ...bounds, y });
      syncHitWin();
    }
    if (done) fallGroundY = null;
  });

  on("start-drag-reaction", (_event, direction) => {
    const normalized = direction === "left" || direction === "right" ? direction : null;
    if (requestDragReaction) requestDragReaction(normalized);
    else sendToRenderer("start-drag-reaction", normalized);
  });
  on("end-drag-reaction", () => sendToRenderer("end-drag-reaction"));
  on("play-click-reaction", (_event, svg, duration) => {
    // A click reaction is a high-level pet intent. Physical adapters consume
    // it here; renderer animation remains a parallel virtual projection.
    try { onPetIntent({ type: "perform", action: "quack", source: "local" }); } catch {}
    if (requestClickReaction) requestClickReaction(svg, duration);
    else sendToRenderer("play-click-reaction", svg, duration);
  });

  on("drag-end", () => {
    try {
      if (!isMiniMode() && !isMiniTransitioning()) {
        if (!getDisableMiniMode()) checkMiniModeSnap();
        if (isMiniMode() || isMiniTransitioning()) return;
        if (hasPetWindow()) {
          const virtualBounds = getPetWindowBounds();
          const size = getEffectiveCurrentPixelSize();
          const clamped = computeDragEndBounds(virtualBounds, size);
          if (clamped) {
            applyPetWindowBounds(clamped);
            flushRuntimeStateToPrefs();
          }
          reassertWinTopmost();
          scheduleHwndRecovery();
          syncHitWin();
          syncDisplayedVisualGeometry();
          repositionFloatingBubbles();
        }
      }
    } finally {
      setDragLocked(false);
      clearDragSnapshot();
      // Normally the preceding drag-lock(false) already re-ran the dodge, but
      // this handler also releases the lock defensively — mirror the re-run so
      // a drag-end without a paired drag-lock(false) can't strand the deferred
      // click-through write.
      syncImeEditingPetDodge();
    }
  });

  on("exit-mini-mode", () => {
    if (isMiniMode()) exitMiniMode();
  });

  on("pet-interaction:reveal-session-hud", () => {
    revealSessionHud();
  });

  // OS file drop from the hit window (#459, Windows/Linux only): first path
  // wins, files resolve to their parent directory, then open a plain terminal
  // there (no agent). The accept ping goes back to the SENDING window (hit
  // renderer plays its own reaction so its isReacting gate stays consistent).
  // macOS never registers the renderer-side listeners (screen-saver-level
  // windows are invisible to macOS drag-destination search); this guard is the
  // second layer so a stray IPC can't open terminals there either.
  on("pet-drop-paths", async (event, paths) => {
    try {
      if (isMacPlatform) {
        dropLog("drop ignored: OS file drop is disabled on macOS");
        return;
      }
      if (isMiniMode() || isMiniTransitioning()) return;
      if (!Array.isArray(paths)) return;
      const first = paths.find((p) => typeof p === "string" && p.length > 0);
      if (!first) return;
      let stats;
      try {
        stats = await statPath(first);
      } catch (_) {
        dropLog(`drop ignored: stat failed for ${first}`);
        return;
      }
      const dir = stats.isDirectory() ? first : path.dirname(first);
      const result = await openTerminalAt(dir);
      if (result && result.ok) {
        dropLog(`drop opened terminal=${result.terminal} dir=${dir}`);
        const sender = event && event.sender;
        if (sender && typeof sender.send === "function" && !(typeof sender.isDestroyed === "function" && sender.isDestroyed())) {
          sender.send("pet-drop-accepted");
        }
      } else {
        dropLog(`drop terminal launch failed: ${(result && result.message) || "unknown"}`);
      }
    } catch (err) {
      dropLog(`drop error: ${(err && err.message) || err}`);
    }
  });

  on("focus-terminal", () => {
    const focusableIds = getFocusableLocalHudSessionIds();
    focusLog(`focus request source=pet-body sid=- focusableCount=${focusableIds.length}`);
    if (focusableIds.length > 1) {
      focusLog(`focus result branch=none reason=multi-session-open-dashboard count=${focusableIds.length}`);
      showDashboard();
      return;
    }
    if (focusableIds.length === 1) {
      focusSession(focusableIds[0], { requestSource: "pet-body" });
      return;
    }
    focusLog("focus result branch=none reason=no-focusable-session source=pet-body");
  });

  return {
    // duck-on-desk: the post-release fall writes the window every frame — a
    // reconcile-protected period, like roam.
    isDuckLiftFalling: () => fallGroundY !== null,
    dispose() {
      while (disposers.length) {
        const dispose = disposers.pop();
        dispose();
      }
    },
  };
}

module.exports = {
  isTrustedMainFrameEvent,
  registerPetInteractionIpc,
};
