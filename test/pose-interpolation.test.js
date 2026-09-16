const assert = require('node:assert/strict');
const test = require('node:test');

test('pose tween progress clamps malformed and out-of-range times', async () => {
  const {poseTweenProgress}=await import('../renderer/src/runtime/pose-interpolation.js');
  assert.equal(poseTweenProgress(50,0,100),.5);
  assert.equal(poseTweenProgress(-1,0,100),0);
  assert.equal(poseTweenProgress(101,0,100),1);
  assert.equal(poseTweenProgress(50,0,0),1);
});

test('frame blend is refresh-rate independent', async () => {
  const {frameBlend}=await import('../renderer/src/runtime/pose-interpolation.js');
  const one=frameBlend(32,35);
  const two=1-(1-frameBlend(16,35))**2;
  assert.ok(Math.abs(one-two)<1e-12);
  assert.equal(frameBlend(0),0);
  assert.equal(frameBlend(16,0),1);
});
