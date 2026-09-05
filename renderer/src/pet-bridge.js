// Consumes the main-process preload contract (src/preload.js) and drives the duck.
// The only mandatory reply is notifyPetVisualSettled; without it main reloads the window after 9750 ms.
export function connectPetBridge({ api = window.electronAPI, runtime, behaviours, audio }) {
  const settle = (request, file) => api.notifyPetVisualSettled({
    themeId: (request && request.themeId) || "duck",
    displayState: (request && request.displayState) || null,
    requestedFile: file,
    actualFile: file,
    channel: "duck3d",
    verified: true,
    visualGeneration: request && Number.isSafeInteger(request.visualGeneration) ? request.visualGeneration : null,
    outcome: "swapped",
  });

  api.onStateChange((requestOrState, legacySvg) => {
    const request = requestOrState && typeof requestOrState === "object" ? requestOrState : null;
    const file = request ? request.file : legacySvg;
    if (typeof file !== "string" || !file) return;
    behaviours.apply(file);
    settle(request, file);
  });
  api.onEyeMove((dx, dy) => behaviours.eye(dx, dy));
  if (typeof api.onRoamHeading === "function" && typeof behaviours.setRoamHeading === "function") {
    api.onRoamHeading((left) => behaviours.setRoamHeading(left));
  }
  // Free roam picks its direction from the side the duck leans to (2 Hz is plenty).
  const facingTimer = typeof api.reportDuckFacing === "function" && typeof runtime.snapshot === "function"
    ? setInterval(() => { const s = runtime.snapshot(); if (s && Number.isFinite(s.facing)) api.reportDuckFacing(s.facing); }, 500)
    : null;
  api.onDndChange(() => {});
  // Pick-up: main sends start-drag-reaction on press (and again on drag moves
  // with a direction); the first one lifts, repeats are ignored, and the
  // reaction request tuple is settled like any visual so main never falls back.
  let held = false;
  api.onStartDragReaction((requestOrDirection) => {
    const request = requestOrDirection && typeof requestOrDirection === "object" ? requestOrDirection : null;
    if (request && typeof request.file === "string") settle(request, request.file);
    if (held) return;
    held = true;
    runtime.command({ type: "grab-start", source: "local" });
  });
  api.onEndDragReaction(() => {
    if (!held) return;
    held = false;
    runtime.command({ type: "grab-end", source: "local" });
  });
  api.onPlayClickReaction(() => runtime.command({ type: "perform", action: "quack", source: "local" }));
  api.onWakeFromDoze(() => runtime.command({ type: "wake", source: "local" }));
  api.onThemeConfig(() => {});
  api.onPlaySound(() => {}); // the duck owns its own sound design
  api.onPreloadSounds(() => {});
  api.onInvalidateSoundCache(() => {});
  if (typeof api.onDuckAppearanceChange === "function") {
    api.onDuckAppearanceChange((name) => {
      runtime.command({ type: "appearance", name, source: "local" });
      audio.setAppearance(name);
    });
  }
  api.onDuckMutedChange?.((muted) => audio.setMuted(muted));
  api.notifyPetVisualReady();
  return { dispose: () => { if (facingTimer) clearInterval(facingTimer); behaviours.dispose(); } };
}
