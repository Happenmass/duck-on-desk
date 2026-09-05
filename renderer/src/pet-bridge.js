// Consumes the main-process preload contract (src/preload.js) and drives the duck.
// The only mandatory reply is notifyPetVisualSettled; without it main reloads the window after 9750 ms.
export function connectPetBridge({
  api = window.electronAPI, runtime, behaviours, audio,
  stage = typeof document === "undefined" ? null : document.getElementById("stage"),
  viewport = () => (typeof window === "undefined" ? { width: 400, height: 400 } : { width: window.innerWidth, height: window.innerHeight }),
  raf = (fn) => requestAnimationFrame(fn),
  now = () => performance.now(),
  onResize = (fn) => { if (typeof window !== "undefined") window.addEventListener("resize", fn); },
}) {
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
  // Middle-button pick-up (main side: src/duck-lift.js). Main enlarges the
  // window to the whole work area; we pin the stage (the 3D canvas, unchanged
  // in size) to the duck's old spot, carry it with the pointer, drop it with
  // gravity to the work-area bottom, report where it landed, and un-pin once
  // main has shrunk the window back around that spot. Pin/un-pin happen on
  // the resize event so they land in the same frame as the window change.
  const FALL_G = 9.81; // m/s²; the stage frames about STAGE_METRES of height
  const STAGE_METRES = 0.4;
  let lift = null; // { origin, x, y, phase: carry | fall | landed, vy, last, pinned }
  const enlarged = () => !!lift && viewport().width > lift.origin.width;
  const pin = () => {
    if (!lift) return;
    lift.pinned = true;
    if (!stage) return;
    stage.style.inset = "auto";
    stage.style.left = `${lift.x}px`;
    stage.style.top = `${lift.y}px`;
    stage.style.width = `${lift.origin.width}px`;
    stage.style.height = `${lift.origin.height}px`;
  };
  const unpin = () => { if (stage) stage.style.cssText = ""; lift = null; };
  const fallFrame = (t) => {
    if (!lift || lift.phase !== "fall") return;
    const dt = Math.min(0.05, Math.max(0, (t - lift.last) / 1000));
    lift.last = t;
    lift.vy += FALL_G * (lift.origin.height / STAGE_METRES) * dt;
    lift.y += lift.vy * dt;
    const floorY = lift.origin.floor - lift.origin.height;
    if (lift.y >= floorY) {
      lift.y = floorY;
      lift.phase = "landed";
      pin();
      runtime.command({ type: "grab-end", source: "local" });
      api.reportDuckLanded?.({ x: lift.x, y: lift.y });
      return;
    }
    pin();
    raf(fallFrame);
  };
  onResize(() => {
    if (!lift) return;
    if (lift.phase === "landed") { if (!enlarged()) unpin(); }
    else if (!lift.pinned && enlarged()) pin();
  });
  api.onDuckLift?.((msg) => {
    if (!msg) return;
    if (msg.phase === "start") {
      if (lift) return;
      const origin = { x: msg.x || 0, y: msg.y || 0, width: msg.width || viewport().width, height: msg.height || viewport().height, floor: msg.floor || viewport().height, right: msg.right || viewport().width };
      lift = { origin, x: origin.x, y: origin.y, phase: "carry", vy: 0, last: 0, pinned: false };
      runtime.command({ type: "grab-start", source: "local" });
      if (enlarged()) pin();
    } else if (msg.phase === "move") {
      if (!lift || lift.phase !== "carry") return;
      lift.x = Math.min(Math.max(lift.origin.x + (msg.dx || 0), 0), lift.origin.right - lift.origin.width);
      lift.y = Math.min(Math.max(lift.origin.y + (msg.dy || 0), 0), lift.origin.floor - lift.origin.height);
      if (lift.pinned) pin();
    } else if (msg.phase === "end") {
      if (!lift || lift.phase !== "carry") return;
      lift.phase = "fall";
      lift.vy = 0;
      lift.last = now();
      raf(fallFrame);
    } else if (msg.phase === "reset") {
      if (lift && lift.phase === "landed" && !enlarged()) unpin();
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
