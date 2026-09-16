const test=require('node:test'),assert=require('node:assert/strict');
test('recorded clip uses simulation time and interpolates antipodal quaternions',async()=>{
  const {samplePreviewClip}=await import('../renderer/src/runtime/preview-clip.js');
  const clip={iteration:400,dt:10,frames:[{root:[0,0,0,1,0,0,0],joints:[0]},{root:[10,0,0,-1,0,0,0],joints:[2]}]};
  const mid=samplePreviewClip(clip,5);assert.equal(mid.root[0],5);assert.equal(mid.root[3],1);assert.equal(mid.joints[0],1);
  assert.equal(samplePreviewClip(clip,10).root[0],10);assert.equal(samplePreviewClip(clip,20).root[0],10);assert.equal(mid.iteration,400);
});
