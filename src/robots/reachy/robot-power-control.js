"use strict";
// One user-facing wake command; hardware adapters own their physical wake movement.
// Microduck can supply the same snapshot()/wakeUp() seam when available.
const { needsWake } = require("./reachy-mini-client");
function createRobotPowerControl({ getAdapter, wakeDesktop }) {
  let pending = null;
  return {
    // The same decision the client's own wake guard makes, so the menu can never
    // hide "Wake" from a robot the adapter would still move — a torqued-but-
    // folded one included.
    needsWake() { return needsWake(getAdapter()?.snapshot()); },
    isBusy() { return !!pending; },
    wake() {
      if (pending) return pending;
      const adapter = getAdapter();
      pending = (async () => {
        if (adapter?.snapshot().connected) await adapter.wakeUp();
        if (getAdapter() !== adapter) return;
        wakeDesktop();
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
// An automatic lifecycle failure (a sleep the desktop asked for) has no other
// surface: the status field is only read by this notifier. It fires once per
// distinct failure, and never for the explicit wake, which reports its own.
function createRobotErrorNotifier({ showError, isExplicitWake = () => false }) {
  let last = null;
  return status => {
    const error = status?.motionError || null;
    if (error === last) return;
    last = error;
    if (error && !isExplicitWake()) showError(error);
  };
}
module.exports = { createRobotPowerControl, createRobotErrorNotifier };
