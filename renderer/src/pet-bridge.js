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
  api.onDndChange(() => {});
  api.onStartDragReaction(() => runtime.command({ type: "grab-start", source: "local" }));
  api.onEndDragReaction(() => runtime.command({ type: "grab-end", source: "local" }));
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
  api.notifyPetVisualReady();
  return { dispose: () => behaviours.dispose() };
}
