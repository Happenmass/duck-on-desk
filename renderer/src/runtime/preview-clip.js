// Sample by simulation time, independent of monitor refresh rate.
export function samplePreviewClip(clip, seconds) {
  const position=Math.max(0,Math.min(clip.frames.length-1,seconds/clip.dt));
  const index=Math.floor(position),a=clip.frames[index],b=clip.frames[Math.min(index+1,clip.frames.length-1)],t=position-index;
  const root=a.root.map((v,i)=>v+(b.root[i]-v)*t);
  const sign=a.root.slice(3).reduce((sum,v,i)=>sum+v*b.root[i+3],0)<0?-1:1;
  for(let i=3;i<7;i++)root[i]=a.root[i]*(1-t)+sign*b.root[i]*t;
  const norm=Math.hypot(...root.slice(3));for(let i=3;i<7;i++)root[i]/=norm||1;
  return {root,joints:a.joints.map((v,i)=>v+(b.joints[i]-v)*t),iteration:clip.iteration,sequence:index};
}
