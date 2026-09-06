// Evaluate an expression inside duck-on-desk's main.js module scope via the Node
// inspector: break on a periodic main.js callback, evaluateOnCallFrame, resume.
// Usage: node main-eval.mjs <0-based line in src/main.js> "<expression>" [timeoutMs]
const [line, expr, timeoutArg] = [Number(process.argv[2]), process.argv[3], Number(process.argv[4] || 15000)];
const targets = await (await fetch("http://127.0.0.1:9357/json")).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
const call = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const waitEvent = (name, ms) => new Promise((res, rej) => { const t0 = Date.now(); const tick = () => { const i = events.findIndex(e => e.method === name); if (i >= 0) return res(events.splice(i, 1)[0]); if (Date.now() - t0 > ms) return rej(new Error("timeout waiting " + name)); setTimeout(tick, 20); }; tick(); });
await call("Debugger.enable");
const bp = await call("Debugger.setBreakpointByUrl", { lineNumber: line, urlRegex: "src/main\\.js$" });
try {
  const paused = await waitEvent("Debugger.paused", timeoutArg);
  const frame = paused.params.callFrames[0];
  const r = await call("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression: expr, returnByValue: true });
  const ex = r.result?.exceptionDetails; const out = ex ? (ex.exception?.description || ex.text) : (r.result?.result?.value ?? r.result ?? r); console.log(String(JSON.stringify(out) ?? out).slice(0, 2000));
} finally {
  await call("Debugger.removeBreakpoint", { breakpointId: bp.result.breakpointId });
  await call("Debugger.resume"); await call("Debugger.disable"); ws.close();
}
