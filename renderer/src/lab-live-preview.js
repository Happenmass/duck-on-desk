import {samplePreviewClip} from './runtime/preview-clip.js';
export function createLivePreview({request,notice}) {
  const el=id=>document.getElementById(id);
  let enabled=false,visible=false,job=null,view=null,timer=null,generation=0,loading=false,lastSequence=-1,pendingToken=null,finishedToken=null;
  const terminal=phase=>['completed','failed','cancelled'].includes(phase);
  const source=document.createElement('select');source.setAttribute('aria-label','预览来源');
  source.innerHTML='<option value="">训练现场</option>';
  el('training-preview').querySelector('.preview-heading').append(source);
  el('training-preview').querySelector('.preview-note').textContent='每累计 200 轮自动保存 10 秒 3D 回放（无需开启预览）。在预览来源中选择轮次即可循环播放；保存的是姿态动画，不是视频文件。';
  let clip=null,playFrame=null,clipRequest=0,lastCatalog=0,catalogPending=false;
  function stopPlayback(){cancelAnimationFrame(playFrame);playFrame=null;clipRequest++;}
  async function playClip(){
    stopPlayback();const token=clipRequest,id=job?.id,iteration=Number(source.value);
    if(!iteration||!id||!view||!visible||!enabled)return;
    try{
      clip=await request('preview-clips',{id,iteration});
      if(token!==clipRequest)return;
      if(!Array.isArray(clip.frames)||clip.frames.length<2||!(clip.dt>0)||!(clip.duration>0))throw new Error('回放文件无效');
      const started=performance.now();view.reset();
      function tick(now){
        if(token!==clipRequest||!view)return;
        const seconds=((now-started)/1000)%clip.duration;
        view.setFrame(samplePreviewClip(clip,seconds),{immediate:true});
        el('live-preview-status').textContent=`第 ${iteration} 轮 · 已保存回放`;
        el('live-preview-detail').textContent=`${seconds.toFixed(1)} / ${clip.duration} 秒 · 循环播放 · 独立仿真试跑`;
        playFrame=requestAnimationFrame(tick);
      }
      playFrame=requestAnimationFrame(tick);
    }catch(error){if(token===clipRequest)notice(error.message,true);}
  }
  async function catalog(){
    if(!job||!visible||catalogPending||Date.now()-lastCatalog<5000)return;
    const id=job.id;catalogPending=true;lastCatalog=Date.now();
    try{const iterations=await request('preview-clips',{id});if(job?.id!==id)return;
      const selected=source.value;source.replaceChildren(new Option('训练现场',''),...iterations.map(n=>new Option(`第 ${n} 轮 · 10 秒`,String(n))));source.value=selected;
    }catch{}finally{catalogPending=false;}
  }
  source.addEventListener('change',()=>{stopPlayback();clearTimeout(timer);timer=null;generation++;finishedToken=null;release(job?.id);
    if(view){if(source.value)playClip();else poll(generation);}
    else {loading=false;start();}
  });
  function release(id){if(id)request('live-preview',{id,enabled:false}).catch(()=>{});}
  function stop(){stopPlayback();generation++;clearTimeout(timer);timer=null;loading=false;view?.dispose();view=null;release(job?.id);lastSequence=-1;}
  function describe(result){
    if(result.supported===false){el('live-preview-status').textContent='此记录没有训练现场数据';el('live-preview-detail').textContent='开启预览后启动一次新训练，就能看到真实采样动作。';return;}
    const frame=result.frame;
    if(!frame){el('live-preview-status').textContent=terminal(result.phase)?'这次练习没有记录预览':'等待第一份训练姿态…';return;}
    const stages={baseline:'训练前试走',sampling:'正在采集试跑经验',learning:'正在更新动作策略',candidate:'训练后试走'};
    el('live-preview-status').textContent=terminal(result.phase)?'练习已结束 · 最后一次采样':Date.now()-frame.captured_at>2500?'等待新采样 · 暂留最后姿态':stages[frame.stage]||'训练采样';
    el('live-preview-detail').textContent=`第 1 只机器人 · 第 ${frame.iteration} 轮 · 仿真时间 ${frame.simulation_time.toFixed(2)} s`;
    if(frame.sequence!==lastSequence&&view?.setFrame(frame))lastSequence=frame.sequence;
  }
  async function poll(token) {
    timer=null;if(source.value||token!==generation||!enabled||!visible||!view||!job||pendingToken===token||finishedToken===token)return;
    pendingToken=token;
    const id=job.id;
    try{const result=await request('live-preview',{id,enabled:true});if(token!==generation||id!==job?.id)return;describe(result);
      if(!terminal(result.phase))timer=setTimeout(()=>poll(token),50);else finishedToken=token;
    }catch(error){if(token===generation){el('live-preview-status').textContent='预览暂时不可用';el('live-preview-detail').textContent=error.message;timer=setTimeout(()=>poll(token),1200);}}
    finally{if(pendingToken===token)pendingToken=null;}
  }
  async function start() {
    if(!enabled||!visible||view||loading)return;
    loading=true;const token=generation;
    el('preview-stage').hidden=false;el('preview-empty').hidden=false;el('preview-empty').textContent='正在加载机器人…';
    try{
      const {createTrainingPreviewView}=await import('./runtime/training-preview-view.js');
      const next=await createTrainingPreviewView(el('preview-stage'));
      if(token!==generation){next.dispose();return;}view=next;el('preview-empty').hidden=true;
      el('live-preview-status').textContent=job?'连接训练现场…':'准备好了，等待开始训练';
      el('live-preview-detail').textContent='预览只显示采样姿态，不控制机器人。';if(source.value)playClip();else poll(token);
    }catch(error){if(token===generation){notice(error.message,true);enabled=false;sync();}}
    finally{if(token===generation)loading=false;}
  }
  function sync(){
    el('live-preview-toggle').setAttribute('aria-pressed',String(enabled));el('live-preview-toggle').textContent=enabled?'关闭 3D 预览':'开启 3D 预览';
    el('training-preview').dataset.enabled=String(enabled);
    if(!enabled){el('preview-stage').hidden=true;el('preview-empty').hidden=false;el('preview-empty').textContent='想看看它怎么练习？可以随时开启预览。';el('live-preview-status').textContent='预览已关闭';el('live-preview-detail').textContent='训练和曲线更新不受开关影响。';}
  }
  el('live-preview-toggle').addEventListener('click',()=>{enabled=!enabled;if(!enabled)stop();sync();if(enabled)start();});sync();
  return {
    showSaved(iteration){stop();if(![...source.options].some(o=>o.value===String(iteration)))source.add(new Option(`第 ${iteration} 轮 · 10 秒`,String(iteration)));source.value=String(iteration);enabled=true;sync();start();},
    setVisible(value){if(visible===value)return;visible=value;if(!visible)stop();else {catalog();start();}},
    setJob(next){const changed=job?.id!==next?.id;if(changed){release(job?.id);generation++;clearTimeout(timer);timer=null;lastSequence=-1;}
      if(changed){stopPlayback();source.replaceChildren(new Option('训练现场',''));lastCatalog=0;}
      job=next;catalog();if(changed&&view){view.reset();el('live-preview-status').textContent='连接新的训练记录…';el('live-preview-detail').textContent='等待这次练习的第一份姿态。';}if(changed&&loading){loading=false;start();}
      if(enabled&&visible&&view&&!timer&&pendingToken!==generation)poll(generation);
    },
    dispose(){enabled=false;stop();},
  };
}
