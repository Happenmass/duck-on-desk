// Consumes the main-process preload contract (src/preload.js) and drives the duck.
// The only mandatory reply is notifyPetVisualSettled; without it main reloads the window after 9750 ms.
export function connectPetBridge({ api = window.electronAPI, runtime, behaviours, audio, viewportHeight = () => (typeof window === "undefined" ? 400 : window.innerHeight) }) {
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
  // While roaming, main moves the window by the distance the duck's feet
  // actually covered (12.5 Hz, like the original pet) so gait and window agree.
  const stepTimer = typeof api.reportDuckDisplacement === "function" && typeof runtime.takeDisplacement === "function"
    ? setInterval(() => {
      const d = runtime.takeDisplacement();
      if (behaviours.current() === "duck-roam" && (d.dx !== 0 || d.dy !== 0)) api.reportDuckDisplacement(d);
    }, 80)
    : null;
  api.onDndChange(() => {});
  // Left-button drag moves the window (upstream behaviour) and never lifts the
  // duck; any reaction tuple main might send is settled so it never falls back.
  api.onStartDragReaction((requestOrDirection) => {
    const request = requestOrDirection && typeof requestOrDirection === "object" ? requestOrDirection : null;
    if (request && typeof request.file === "string") settle(request, request.file);
  });
  api.onEndDragReaction(() => {});
  // Middle-button pick-up: press holds the duck where it is, dragging the
  // pointer up lifts it (a full viewport height ≈ LIFT_PER_VIEWPORT metres),
  // dragging down lowers it, releasing drops it.
  const LIFT_PER_VIEWPORT = 0.4;
  let held = false;
  api.onDuckLift?.((lift) => {
    if (lift.phase === "start") {
      if (held) return;
      held = true;
      runtime.command({ type: "grab-start", source: "local" });
    } else if (lift.phase === "move") {
      if (!held) return;
      const h = Math.max(0, Math.min(LIFT_PER_VIEWPORT, (-lift.dy / Math.max(1, viewportHeight())) * LIFT_PER_VIEWPORT));
      runtime.command({ type: "grab-lift", height: h, source: "local" });
    } else if (lift.phase === "end") {
      if (!held) return;
      held = false;
      runtime.command({ type: "grab-end", source: "local" });
    }
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
  return { dispose: () => { if (facingTimer) clearInterval(facingTimer); if (stepTimer) clearInterval(stepTimer); behaviours.dispose(); } };
}
