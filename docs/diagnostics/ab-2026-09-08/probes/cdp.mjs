// Minimal CDP client against the Electron MAIN process inspector (port 9229).
// Same shape as the A1 harness so results stay comparable.
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
export const call = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
});
export async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
// Run an expression inside the pet renderer (window id 1).
export const inPet = (expression) =>
  evaluate(`process.mainModule.require('electron').BrowserWindow.fromId(1).webContents.executeJavaScript(${JSON.stringify(expression)})`);
export const close = () => ws.close();
