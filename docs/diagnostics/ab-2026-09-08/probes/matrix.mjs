import { evaluate, inPet, close } from './cdp.mjs';
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WARMUP = 8000, SAMPLE = 60000;

const metric = () => evaluate(`(() => {
  const e = process.mainModule.require('electron');
  return { time: Date.now(),
    metrics: e.app.getAppMetrics().map(m => ({ pid: m.pid, type: m.type, cpuSeconds: m.cpu.cumulativeCPUUsage })),
    moves: { ...globalThis.__abMoves },
    bounds: e.BrowserWindow.getAllWindows().map(w => [w.id, JSON.stringify(w.getBounds())]) };
})()`);

// local=100 outranks system roam (90) and autonomy (10): the duck stands still.
const pin = () => inPet(`__duckRuntime.command({type:'move',source:'local',forward:0,heading:0,ttlMs:3600000}); true`);

const order = [
  ['baseline', 'hide-internal', 'tiny-geom'],
  ['hide-internal', 'tiny-geom', 'baseline'],
  ['tiny-geom', 'baseline', 'hide-internal'],
];
const results = [];
try {
  for (let rep = 0; rep < order.length; rep++) {
    for (const mode of order[rep]) {
      await pin();
      await inPet(`__abProbe.apply(${JSON.stringify(mode)})`);
      await sleep(WARMUP);
      await pin();
      const infoA = await inPet('__abProbe.info()');
      const snapA = await inPet('__duckRuntime.snapshot()');
      const start = await metric();
      await sleep(SAMPLE);
      const end = await metric();
      const infoB = await inPet('__abProbe.info()');
      const snapB = await inPet('__duckRuntime.snapshot()');
      const seconds = (end.time - start.time) / 1000;
      const cpu = end.metrics.map(m => ({ pid: m.pid, type: m.type,
        percent: 100 * (m.cpuSeconds - start.metrics.find(x => x.pid === m.pid).cpuSeconds) / seconds }));
      const movesBlocked = { setBounds: end.moves.setBounds - start.moves.setBounds,
                             setPosition: end.moves.setPosition - start.moves.setPosition };
      const moved = JSON.stringify(start.bounds) !== JSON.stringify(end.bounds);
      const sample = { rep, mode, seconds, frames: infoB.frame - infoA.frame,
        calls: infoB.calls, triangles: infoB.triangles, visibleMeshes: infoB.visibleMeshes,
        moved, movesBlocked, snapA, snapB, cpu, start, end,
        valid: !moved && snapA.sleeping === false && snapB.sleeping === false
               && snapA.motionSource === 'local' && snapB.motionSource === 'local'
               && infoB.calls === (mode === 'hide-internal' ? 28 : 71) };
      results.push(sample);
      fs.writeFileSync('matrix.json', JSON.stringify(results, null, 2));
      const f = p => (cpu.find(c => c.pid === p)?.percent ?? NaN).toFixed(2).padStart(6);
      console.log(`rep${rep} ${mode.padEnd(14)} renderer ${f(79939)}  gpu ${f(79937)}  main ${f(79931)}  frames ${sample.frames}  calls ${sample.calls}  tris ${String(sample.triangles).padStart(6)}  blocked ${movesBlocked.setBounds}/${movesBlocked.setPosition}  valid ${sample.valid}`);
    }
  }
} finally {
  await inPet(`__abProbe.apply('baseline'); __duckRuntime.command({type:'stop',source:'local'}); true`);
  close();
}
