export function createDuckActions({ runtime, enabled = true, clock = globalThis, random = Math.random, now = () => performance.now() }) {
  let next = null;
  const tick = () => {
    const s = runtime.snapshot();
    if (!enabled || !s.ready || s.busy || s.stilts || s.locomotion !== 'legs' || !(s.forward > 0)) { next = null; return; }
    if (next === null) next = now() + 25_000 + random() * 30_000;
    if (now() < next) return;
    next = null;
    const actions = runtime.actions();
    if (actions.length) void runtime.playAction(actions[Math.min(actions.length - 1, Math.floor(random() * actions.length))].id).catch(console.error);
  };
  const timer = clock.setInterval(tick, 1000);
  return { setEnabled(value) { enabled = value === true; next = null; }, dispose() { clock.clearInterval(timer); } };
}
