import { evaluate, inPet, close } from './cdp.mjs';
const state = await inPet(`(() => {
  const before = window.__abProbe ? window.__abProbe.info() : null;
  window.__abProbe && window.__abProbe.apply('baseline');
  delete window.__abProbe;
  return { before, probeGone: !window.__abProbe, snapshot: window.__duckRuntime.snapshot() };
})()`);
console.log('renderer:', JSON.stringify(state));
const main = await evaluate(`(() => {
  const { BrowserWindow } = process.mainModule.require('electron');
  const wins = BrowserWindow.getAllWindows().filter(w => [1, 3].includes(w.id));
  for (const w of wins) { delete w.setBounds; delete w.setPosition; }
  const moves = { ...globalThis.__abMoves }; delete globalThis.__abMoves;
  const wc = BrowserWindow.fromId(1).webContents;
  const attached = wc.debugger.isAttached();
  if (attached) wc.debugger.detach();
  return JSON.stringify({
    blockedTotal: moves,
    stillShadowed: wins.map(w => Object.prototype.hasOwnProperty.call(w, 'setBounds')),
    setBoundsIsFunction: wins.every(w => typeof w.setBounds === 'function'),
    debuggerWasAttached: attached, debuggerNowAttached: wc.debugger.isAttached(),
    bounds: wins.map(w => [w.id, JSON.stringify(w.getBounds())]),
  });
})()`);
console.log('main:', main);
close();
