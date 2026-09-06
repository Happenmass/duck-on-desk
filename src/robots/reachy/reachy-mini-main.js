"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ReachyMiniClient, needsWake } = require("./reachy-mini-client");
const { createReachyExpressions } = require("./reachy-expressions");
const { createReachyLiveliness } = require("./reachy-liveliness");

function createReachyMiniMain({ ipcMain, settings, getWindow, sendToRenderer, client = new ReachyMiniClient(), readSound = name => fs.readFileSync(path.join(__dirname, "../../../renderer-dist/assets/reachy-mini", `${name}.wav`)) }) {
  const allowed = event => {
    const win = getWindow();
    return win && !win.isDestroyed() && event.sender === win.webContents;
  };
  let lastPublished = 0;
  let lastPublishedConnected = false;
  let trailing = null;
  let trailingTimer = null;
  const send = status => {
    lastPublished = Date.now(); lastPublishedConnected = status.connected;
    try { sendToRenderer("reachy-status", status); } catch {}
  };
  const publish = status => {
    // Feedback is 50Hz; 25Hz is enough for this small avatar. The last status of
    // a burst still has to arrive: feedback may stop right after it.
    if (Date.now() - lastPublished < 40 && status.connected === lastPublishedConnected) {
      trailing = status;
      if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          const latest = trailing; trailing = null;
          if (latest && !disposed) send(latest);
        }, 40);
        trailingTimer.unref?.();
      }
      return;
    }
    trailing = null;
    send(status);
  };
  let desiredSleeping = false;
  let lifecycleRevision = 0;
  let lastLifecycleAttempt = null;
  let lastSemanticState = null;
  let lastLifecycleStatus = "";
  let lifecycleQueue = Promise.resolve();
  let lifecycleEpoch = 0;
  let audioEpoch = 0;
  let disposed = false;

  const isReachySelected = () => !disposed && settings.get("petRobot") === "reachy-mini";
  // A task resolves truthy only when it actually ran a physical action, so a
  // skipped reconcile can never clear the error left by a real failure.
  const enqueueLifecycle = task => {
    const queued = lifecycleQueue.catch(() => {}).then(task);
    lifecycleQueue = queued.then(
      acted => { if (acted && !disposed && client.snapshot?.().motionError) client.publish?.({ motionError: null }); },
      error => { if (!disposed) client.publish?.({ motionError: error.message }); },
    );
    return queued;
  };
  const lifecycleAttemptKey = snapshot => `${lifecycleEpoch}:${lifecycleRevision}:${desiredSleeping}:${snapshot.url || "offline"}`;
  const reconcileLifecycle = () => enqueueLifecycle(async () => {
    const snapshot = client.snapshot();
    if (!isReachySelected() || !snapshot.connected) return;
    const attemptKey = lifecycleAttemptKey(snapshot);
    if (attemptKey === lastLifecycleAttempt) return;
    if (desiredSleeping) {
      // Disabled motors may belong to another controller. Only an enabled robot
      // is eligible for our official sleep movement.
      if (snapshot.sleeping || !snapshot.motionEnabled || snapshot.motionState === "goto_sleep") return;
      lastLifecycleAttempt = attemptKey;
      await client.goToSleep();
      return true;
    }
    // Automatic wake is paired only with a sleep this process completed.
    if (!snapshot.sleeping || snapshot.motionState === "wake_up") return;
    lastLifecycleAttempt = attemptKey;
    await client.wakeUp();
    return true;
  });

  const files = new Map();
  let audioBusy = false;
  const lifecycleOwnsAudio = (name, snapshot) => snapshot.connected && (
    name === "sleep" || name === "wake" ||
    !!snapshot.motionState ||
    (!desiredSleeping && snapshot.sleeping)
  );
  const playCue = async name => {
    if (!isReachySelected() || !["chirp", "error", "sleep", "wake"].includes(name)) return { sink: "none" };
    if (settings.get("duckMuted")) return { sink: "none" };
    const volume = Math.max(0, Math.min(1, Number(settings.get("duckVoiceVolume")) || 0));
    if (!volume) return { sink: "none" };
    const snapshot = client.snapshot();
    if (!snapshot.connected) {
      try { sendToRenderer("reachy-local-sound", name); } catch {}
      return { sink: "desktop" };
    }
    if (lifecycleOwnsAudio(name, snapshot)) return { sink: "robot", skipped: true };
    if (audioBusy) return { sink: "robot", skipped: true };
    audioBusy = true;
    const epoch = audioEpoch;
    const connectionGeneration = client.generation;
    const url = snapshot.url;
    try {
      if (!files.has(name)) files.set(name, readSound(name));
      const bytes = Buffer.from(files.get(name));
      await client.setVolume(volume);
      const current = client.snapshot();
      if (epoch !== audioEpoch || connectionGeneration !== client.generation || !isReachySelected() || settings.get("duckMuted") || !current.connected || current.url !== url || lifecycleOwnsAudio(name, current)) {
        return { sink: "robot", cancelled: true };
      }
      const key = `duck-on-desk-${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
      return await client.playSound(bytes, key);
    } catch { return { sink: "robot", error: true }; }
    finally { audioBusy = false; }
  };

  const cueForState = state => {
    if (["attention", "notification", "carrying", "mini-happy", "mini-alert"].includes(state)) return "chirp";
    if (state === "error") return "error";
    if (state === "sleeping" || state === "mini-sleep") return "sleep";
    if (state === "waking") return "wake";
    return null;
  };

  const handleSemanticState = (state, options = {}) => {
    if (typeof state !== "string" || !state) return false;
    const changed = state !== lastSemanticState;
    lastSemanticState = state;
    const nextSleeping = state === "sleeping" || state === "mini-sleep";
    if (nextSleeping !== desiredSleeping) {
      desiredSleeping = nextSleeping;
      lifecycleRevision++;
    }
    if (isReachySelected()) void reconcileLifecycle();
    liveliness.handleState(state);
    const expressed = expressions.handleState(state, options) === true;
    if (!changed || options.initial === true || !isReachySelected()) return changed;
    const cue = cueForState(state);
    const notificationMuted = (state === "notification" || state === "mini-alert") && options.muteNotificationSound === true;
    // An entry expression plays the daemon's own sound for this event; the
    // desktop cue would only double it (and used to lose a race against it).
    if (cue && !notificationMuted && !expressed) void playCue(cue);
    return changed;
  };

  const expressions = createReachyExpressions({
    client, settings, isReachySelected, isSleepIntended: () => desiredSleeping,
  });
  const liveliness = createReachyLiveliness({
    client, settings, isReachySelected, isSleepIntended: () => desiredSleeping,
  });
  const onStatus = status => {
    expressions.onStatus(status);
    liveliness.onStatus(status);
    const wasConnected = lastLifecycleStatus.startsWith("true:");
    if (status.connected !== wasConnected && lastLifecycleStatus) audioEpoch++;
    publish(status);
    const lifecycleStatus = `${status.connected}:${status.motionEnabled}:${status.sleeping}:${status.motionState || ""}`;
    if (lifecycleStatus === lastLifecycleStatus) return;
    const connectedNow = status.connected === true && !wasConnected;
    lastLifecycleStatus = lifecycleStatus;
    if (connectedNow) syncVolume();
    if (status.connected) void reconcileLifecycle();
  };
  client.on("status", onStatus);
  const reconcile = () => {
    lifecycleEpoch++;
    audioEpoch++;
    lastLifecycleAttempt = null;
    expressions.refresh();
    liveliness.refresh();
    if (settings.get("petRobot") === "reachy-mini" && settings.get("reachyAutoConnect")) client.start(settings.get("reachyHost"));
    else client.stop();
  };
  const subscriptions = ["petRobot", "reachyAutoConnect", "reachyHost"].map(key => settings.subscribeKey(key, reconcile));
  subscriptions.push(settings.subscribeKey("reachyExpressions", () => { expressions.refresh(); liveliness.refresh(); }));
  const syncVolume = () => {
    const volume = settings.get("duckMuted") ? 0 : Math.max(0, Math.min(1, Number(settings.get("duckVoiceVolume")) || 0));
    void client.setVolume(volume).catch(error => client.publish?.({ audioError: error.message }));
  };
  for (const key of ["duckMuted", "duckVoiceVolume"]) subscriptions.push(settings.subscribeKey(key, () => {
    audioEpoch++;
    void client.stopSound();
    syncVolume();
  }));
  syncVolume();
  ipcMain.handle("reachy-status", event => allowed(event) ? client.snapshot() : null);
  reconcile();
  return {
    client,
    snapshot: () => client.snapshot(),
    handleSemanticState,
    handleIntent: intent => {
      if (!intent || intent.type !== "perform" || intent.action !== "quack" || !isReachySelected()) return false;
      void playCue("chirp");
      return true;
    },
    playCue,
    wakeUp: () => {
      if (desiredSleeping) {
        desiredSleeping = false;
        lifecycleRevision++;
      }
      // Reserve this target before entering the queue. A previously queued
      // reconcile reads the latest target and must not race the explicit wake.
      const target = client.snapshot();
      const epoch = lifecycleEpoch;
      const connectionGeneration = client.generation;
      lastLifecycleAttempt = lifecycleAttemptKey(target);
      return enqueueLifecycle(async () => {
        const current = client.snapshot();
        if (!isReachySelected() || epoch !== lifecycleEpoch || connectionGeneration !== client.generation || !current.connected || current.url !== target.url) return;
        // The menu offers "Wake" whenever the desktop is in do-not-disturb. A
        // robot standing at its idle pose only needs the desktop woken; issuing
        // wake_up would be a gratuitous move. A robot torqued at the folded
        // sleep pose is not that, whoever enabled its motors.
        if (!needsWake(current)) return;
        await client.wakeUp();
        return true;
      });
    },
    dispose() {
      disposed = true;
      lifecycleEpoch++;
      audioEpoch++;
      clearTimeout(trailingTimer); trailingTimer = null; trailing = null;
      expressions.dispose();
      liveliness.dispose();
      client.off("status", onStatus); client.stop();
      for (const unsubscribe of subscriptions) unsubscribe();
      ipcMain.removeHandler("reachy-status");
    },
  };
}

module.exports = { createReachyMiniMain };
