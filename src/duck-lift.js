"use strict";
// duck-on-desk: middle-button pick-up. While the button is held the render
// window covers the whole work area so the duck can be carried anywhere; the
// renderer keeps drawing it at its old size inside that page. On release the
// renderer lets it fall to the work-area bottom and reports where it landed;
// the window then shrinks back to its normal size at that spot.
const LAND_WATCHDOG_MS = 8000;

module.exports = function createDuckLift(deps) {
  const {
    getRenderWindow, screen, getPetWindowBounds, applyPetWindowBounds, syncHitWin,
    sendToRenderer, cancelRoam, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
  } = deps;
  let lift = null; // { small, wa } while the window is enlarged
  let watchdog = null;

  function begin() {
    const win = getRenderWindow();
    if (lift || !win || win.isDestroyed()) return null;
    const small = getPetWindowBounds();
    if (!small) return null;
    const wa = screen.getDisplayMatching(small).workArea;
    lift = { small: { ...small }, wa: { ...wa } };
    cancelRoam();
    const origin = { x: small.x - wa.x, y: small.y - wa.y, width: small.width, height: small.height, floor: wa.height, right: wa.width };
    // Tell the renderer first so it can pin its stage to the old spot in the
    // same frame the window grows (see pet-bridge.js); then grow the window.
    sendToRenderer("duck-lift", { phase: "start", ...origin });
    win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
    return origin;
  }

  function move(dx, dy) {
    if (!lift) return;
    sendToRenderer("duck-lift", { phase: "move", dx, dy });
  }

  function release() {
    if (!lift) return;
    sendToRenderer("duck-lift", { phase: "end" });
    // The renderer normally reports the landing within a second; if it never
    // does (reload, crash), put the window back where the walk started.
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => { watchdog = null; if (lift) land(lift.small.x - lift.wa.x, lift.small.y - lift.wa.y); }, LAND_WATCHDOG_MS);
  }

  // x/y: the stage's top-left inside the enlarged page (work-area coordinates).
  function land(x, y) {
    if (!lift) return;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    const { small, wa } = lift;
    lift = null;
    const px = Math.round(Math.min(Math.max(Number(x) || 0, 0), wa.width - small.width));
    const py = Math.round(Math.min(Math.max(Number(y) || 0, 0), wa.height - small.height));
    sendToRenderer("duck-lift", { phase: "reset" });
    applyPetWindowBounds({ x: wa.x + px, y: wa.y + py, width: small.width, height: small.height }, { force: true });
    syncHitWin();
  }

  return { begin, move, release, land, isActive: () => !!lift };
};
