import { evaluate, inPet, close } from './cdp.mjs';
const on = process.argv[2] !== 'off';
console.log(await evaluate(`(() => {
  const { BrowserWindow } = process.mainModule.require('electron');
  const wins = BrowserWindow.getAllWindows().filter(w => [1, 3].includes(w.id));
  if (${on}) {
    globalThis.__abMoves = { setBounds: 0, setPosition: 0 };
    for (const w of wins) {
      // Own-property shadow over the prototype method; delete restores it.
      w.setBounds = () => { globalThis.__abMoves.setBounds++; };
      w.setPosition = () => { globalThis.__abMoves.setPosition++; };
    }
  } else {
    for (const w of wins) { delete w.setBounds; delete w.setPosition; }
  }
  return JSON.stringify({
    frozen: ${on}, ids: wins.map(w => w.id),
    shadowed: wins.map(w => Object.prototype.hasOwnProperty.call(w, 'setBounds')),
    bounds: wins.map(w => [w.id, JSON.stringify(w.getBounds())]),
    moves: globalThis.__abMoves || null,
  });
})()`));
// Make sure the killed run left nothing applied.
console.log('probe:', JSON.stringify(await inPet(`__abProbe.apply('baseline')`)));
close();
