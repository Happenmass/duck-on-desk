const parts = {head:'头颈', left:'左腿', right:'右腿'};
const descriptions = {
  hip_yaw:['髋部转向','让整条腿向内或向外转，帮助机器人转向。'],
  hip_roll:['髋部侧摆','让腿向身体两侧打开或收拢，用来调整左右平衡。'],
  hip_pitch:['髋部前后摆','让大腿前后摆动，是迈步的起点。'],
  knee:['膝盖弯曲','改变膝盖弯曲程度，让腿抬起或伸展。'],
  ankle:['脚踝俯仰','让脚尖抬起或压下，调整脚掌与地面的角度。'],
  neck_pitch:['颈部前后倾','让整个头颈前倾或后仰。'],
  head_pitch:['头部上下点','让头部抬起或低下，类似点头。'],
  head_yaw:['头部左右转','让头部向左或向右看。先拖动这个关节，最容易看出变化。'],
  head_roll:['头部左右歪','让头部向两侧倾斜，类似歪头。'],
};
function describe(name) {
  const part = name.startsWith('left_') ? 'left' : name.startsWith('right_') ? 'right' : 'head';
  const key = part === 'head' ? name : name.replace(/^(left|right)_/, '');
  const [title,purpose] = descriptions[key] || [name,'该关节的旋转角度。'];
  return {part,title:part === 'head' ? title : `${parts[part]} · ${title}`,purpose};
}
const degrees = n => n * 180 / Math.PI;
const radians = n => n * Math.PI / 180;
const clamp = (n,lo,hi) => Math.min(hi,Math.max(lo,n));
const svgNS = 'http://www.w3.org/2000/svg';

// Owns selection, pose editing and the linked view. All values come from the live runtime.
export function createJointConsole({runtime,notice}) {
  const el = id => document.getElementById(id);
  const listeners = new AbortController();
  const on = (node,event,fn) => node.addEventListener(event,fn,{signal:listeners.signal});
  const channels = new Map(), pins = new Map(), wires = new Map();
  const initial = runtime.labSnapshot();
  let selected = initial.joints.find(j=>j.name==='head_yaw')?.name || initial.joints[0].name;
  let filter = 'all', busy = false, editing = false, disposed = false;
  let trace = [], lastSample = 0, lastFrame = 0, frame;
  const pending = new Set();
  const canvas = el('joint-chart'), ctx = canvas.getContext('2d');
  el('input-count').textContent = initial.observationSize;
  el('output-count').textContent = initial.outputSize;
  el('joint-count').textContent = initial.joints.length;
  for (const joint of initial.joints) {
    const meta = describe(joint.name), code = String(joint.outputIndex+1).padStart(2,'0');
    const button = document.createElement('button');
    button.className = 'channel-row'; button.dataset.joint = joint.name;
    button.dataset.outputIndex = joint.outputIndex; button.dataset.part = meta.part;
    button.setAttribute('aria-label',`输出 ${code}，${meta.title}`);
    const index = document.createElement('span'); index.className = 'channel-index'; index.textContent = code;
    const label = document.createElement('span'); label.className = 'channel-name'; label.textContent = meta.title;
    const value = document.createElement('span'); value.className = 'channel-value';
    const level = document.createElement('i'); level.className = 'channel-level';
    button.append(index,label,value,level); el('joints').append(button);
    channels.set(joint.name,{button,value,level}); on(button,'click',()=>select(joint.name));
    const pin = document.createElement('button'); pin.className = 'joint-pin';
    pin.textContent = code; pin.dataset.joint = joint.name; pin.title = meta.title;
    pin.setAttribute('aria-label',`选择${meta.title}`);
    el('joint-pins').append(pin); pins.set(joint.name,pin); on(pin,'click',()=>select(joint.name));
    const wire = document.createElementNS(svgNS,'path'); wire.classList.add('signal-wire');
    wire.dataset.joint = joint.name; el('wire-paths').append(wire); wires.set(joint.name,wire);
  }
  const focusWire = document.createElementNS(svgNS,'path');
  focusWire.classList.add('signal-wire','inspector-link'); el('wire-paths').append(focusWire);

  function select(name) {
    selected = name; trace = []; lastSample = 0;
    const meta = describe(name), j = runtime.labSnapshot().joints.find(j=>j.name===name);
    runtime.labView('select',name);
    channels.get(name).button.scrollIntoView({block:'nearest'});
    for (const [key,c] of channels) {
      c.button.classList.toggle('active',key===name);
      c.button.setAttribute('aria-pressed',String(key===name));
      pins.get(key).classList.toggle('active',key===name);
      pins.get(key).setAttribute('aria-pressed',String(key===name));
    }
    el('selected-channel').textContent = `OUT ${String(j.outputIndex+1).padStart(2,'0')}`;
    el('selected-part').textContent = parts[meta.part];
    el('joint-title').textContent = meta.title; el('joint-purpose').textContent = meta.purpose;
    el('model-selection').textContent = `${String(j.outputIndex+1).padStart(2,'0')} / ${meta.title}`;
    el('joint-mapping').textContent = `actions[${j.outputIndex}] → ${name}`;
    el('joint-formula').textContent = `模型控制时：目标角度 = 站姿 ${degrees(j.defaultPosition).toFixed(1)}° + 模型输出（弧度换算为度）`;
    el('joint-position').dataset.controlJoint = name;
    el('joint-position').setAttribute('aria-label',`${meta.title}角度`);
    el('joint-position').dataset.unit = 'degrees';
    el('joint-actual').dataset.joint = name;
    for (const id of ['joint-position','joint-number']) {
      el(id).min = degrees(j.range[0]); el(id).max = degrees(j.range[1]);
      el(id).value = degrees(j.position).toFixed(1);
    }
    el('range-min').textContent = `${degrees(j.range[0]).toFixed(0)}°`;
    el('range-max').textContent = `${degrees(j.range[1]).toFixed(0)}°`;
    tick();
  }
  async function pose(value) {
    if (busy || !Number.isFinite(value)) return;
    const name = selected, j = runtime.labSnapshot().joints.find(j=>j.name===name);
    const position = clamp(radians(value),...j.range);
    el('joint-position').value = el('joint-number').value = degrees(position).toFixed(1);
    // Track in-flight edits so telemetry cannot snap a thumb back while a step is finishing.
    const operation = runtime.labControl('joint',{name,position}); pending.add(operation);
    try { await operation; } catch(error) { notice(error.message,true); }
    finally { pending.delete(operation); tick(); }
  }
  on(el('joint-position'),'pointerdown',()=>editing=true);
  on(window,'pointerup',()=>editing=false);
  on(window,'pointercancel',()=>editing=false);
  on(el('joint-position'),'input',event=>pose(Number(event.target.value)));
  on(el('joint-number'),'change',event=>{if(event.target.value.trim())pose(Number(event.target.value));});
  on(el('angle-minus'),'click',()=>pose(Number(el('joint-position').value)-5));
  on(el('angle-plus'),'click',()=>pose(Number(el('joint-position').value)+5));
  on(el('joint-home'),'click',()=>pose(degrees(runtime.labSnapshot().joints.find(j=>j.name===selected).defaultPosition)));
  for (const button of document.querySelectorAll('[data-part]:not(.channel-row)')) on(button,'click',()=>{
    filter = button.dataset.part;
    for (const b of document.querySelectorAll('.part-filters button')) {b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}
    for (const c of channels.values()) c.button.hidden = filter!=='all' && c.button.dataset.part!==filter;
    if (filter!=='all' && describe(selected).part!==filter) select(initial.joints.find(j=>describe(j.name).part===filter).name);
  });
  on(el('hologram'),'click',()=>{
    const enabled = el('hologram').getAttribute('aria-pressed')!=='true';
    runtime.labView('hologram',enabled); el('hologram').setAttribute('aria-pressed',String(enabled));
    el('hologram').textContent = enabled ? '透视模型' : '实体模型';
  });
  on(el('camera-home'),'click',()=>runtime.labView('camera','home'));
  for (const button of document.querySelectorAll('[data-camera]')) on(button,'click',()=>runtime.labView('camera',button.dataset.camera));

  function drawTrace(j,now) {
    if (now-lastSample>100) { trace.push([now,j.position]); lastSample=now; }
    trace = trace.filter(([t])=>t>=now-8000);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = '#23313e'; ctx.lineWidth = 1;
    for (const y of [20,60,100]) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(480,y);ctx.stroke();}
    ctx.strokeStyle = '#70e1cb'; ctx.lineWidth = 2; ctx.beginPath();
    trace.forEach(([t,v],i)=>{
      const x = 480*(1-(now-t)/8000), y = 110-100*clamp((v-j.range[0])/(j.range[1]-j.range[0]),0,1);
      if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    });ctx.stroke();
  }
  function tick() {
    if (disposed) return;
    const s = runtime.labSnapshot(), j = s.joints.find(j=>j.name===selected), manual = s.controlMode==='manual';
    el('control-deck').dataset.mode = s.controlMode;
    document.querySelector('.signal-overview').classList.toggle('manual',manual);
    el('control-deck').classList.toggle('running',!s.paused);
    el('controller-label').textContent = manual ? '手动摆姿' : s.action ? '动作模型' : '行走模型';
    el('controller-description').textContent = manual ? '你直接指定角度，行走模型暂停接管' : '把身体信息转换成各关节的目标角度';
    el('stream-state').textContent = s.paused ? '已暂停' : '实时';
    el('view-state').textContent = s.action ? ({settling:'停下站稳',playing:'动作播放中',returning:'回到站立'}[s.action.phase]||s.action.phase) : manual ? (s.paused?'手动摆姿 · 拖动即预览':'物理模拟 · 维持手动目标') : (s.paused?'模型已暂停 · 可直接摆姿':`行走模型运行中 · ${s.controlHz} Hz`);
    el('play').textContent = s.paused ? '运行仿真' : '暂停仿真';
    el('policy-control').disabled = busy || (!manual && !s.action);
    el('telemetry').textContent = `${s.time.toFixed(1)} s · ${s.velocity.toFixed(2)} m/s · 身体高度 ${s.position[2].toFixed(2)} m`;
    for (const joint of s.joints) {
      const c = channels.get(joint.name);
      c.value.textContent = `${degrees(joint.target).toFixed(0)}°`;
      c.button.title = `目标 ${degrees(joint.target).toFixed(1)}° · 当前 ${degrees(joint.position).toFixed(1)}°`;
      c.level.style.width = `${clamp((joint.target-joint.range[0])/(joint.range[1]-joint.range[0]),0,1)*100}%`;
      c.button.dataset.policyOutput = joint.policyOutput ?? '';
    }
    el('joint-actual').textContent = degrees(j.position).toFixed(1);
    el('joint-actual').dataset.radians = j.position;
    el('angle-caption').textContent = manual && s.paused ? '摆姿角度 · 物理已暂停' : '当前角度';
    el('angle-progress').style.width = `${clamp((j.position-j.range[0])/(j.range[1]-j.range[0]),0,1)*100}%`;
    el('joint-target').textContent = `${degrees(j.target).toFixed(1)}°`;
    el('joint-output').textContent = manual ? '手动模式，未经过模型' : j.policyOutput===null ? '尚未运行' : `${j.policyOutput.toFixed(4)} rad`;
    if (!editing && !pending.size) {
      el('joint-position').value = degrees(j.position).toFixed(1);
      if(document.activeElement!==el('joint-number'))el('joint-number').value=degrees(j.position).toFixed(1);
    }
    if (!el('control-view').hidden) drawTrace(j,performance.now());
  }
  function project(now) {
    frame = requestAnimationFrame(project);
    if (now-lastFrame<50 || el('control-view').hidden) return;
    lastFrame=now;
    const deck = el('control-deck').getBoundingClientRect(), stage = el('lab-stage').getBoundingClientRect();
    if (!stage.width || !stage.height) return;
    const inspector = document.querySelector('.joint-inspector').getBoundingClientRect();
    const projected = runtime.labView('project');
    el('signal-wires').setAttribute('viewBox',`0 0 ${deck.width} ${deck.height}`);
    // The head and hip pivots are close together. Spread clickable labels vertically;
    // their leader lines still end at the exact projected joint origins.
    const visible = projected.filter(p=>p.visible&&(filter==='all'||describe(p.name).part===filter));
    const labels = visible.map(p=>({...p,px:p.x*stage.width+(describe(p.name).part==='right'?-27:27),py:p.y*stage.height})).sort((a,b)=>a.py-b.py);
    for(let i=0;i<labels.length;i++) {
      labels[i].px=clamp(labels[i].px,16,stage.width-16);
      labels[i].py=clamp(labels[i].py,108,stage.height-85);
      for(let attempt=0;attempt<30;attempt++) {
        if(!labels.slice(0,i).some(p=>Math.hypot(p.px-labels[i].px,p.py-labels[i].py)<24))break;
        if(labels[i].py+24<stage.height-85)labels[i].py+=24;else labels[i].px+=24;
      }
    }
    for (const p of projected) {
      const pin = pins.get(p.name), wire = wires.get(p.name), channel = channels.get(p.name);
      const label = labels.find(l=>l.name===p.name);
      pin.hidden = !label; wire.style.display = !label || channel.button.hidden ? 'none' : '';
      if (!label) continue;
      const px=clamp(label.px,14,stage.width-14),py=clamp(label.py,110,stage.height-88);
      pin.style.left=`${px}px`;pin.style.top=`${py}px`;
      const row=channel.button.getBoundingClientRect(),x1=row.right-deck.left,y1=row.top+row.height/2-deck.top;
      const list=el('joints').getBoundingClientRect();
      if(row.top<list.top-1||row.bottom>list.bottom+1)wire.style.display='none';
      const x2=stage.left-deck.left+p.x*stage.width,y2=stage.top-deck.top+p.y*stage.height;
      const lx=stage.left-deck.left+px,ly=stage.top-deck.top+py;
      wire.setAttribute('d',`M${x1},${y1} C${x1+65},${y1} ${x2-80},${y2} ${x2},${y2} L${lx},${ly}`);
      wire.classList.toggle('active',p.name===selected);
      if (p.name===selected) {
        const end=inspector.left-deck.left,endY=inspector.top-deck.top+116;
        focusWire.setAttribute('d',`M${lx+10},${ly} C${lx+70},${ly} ${end-45},${endY} ${end},${endY}`);
      }
    }
    focusWire.style.display = visible.some(p=>p.name===selected) ? '' : 'none';
  }
  function setBusy(value) {
    busy = value;
    for (const id of ['joint-position','joint-number','angle-minus','angle-plus','joint-home','forward','turn'])el(id).disabled=busy;
    tick();
  }
  select(selected); setBusy(false); frame=requestAnimationFrame(project);
  return {tick,setBusy,dispose(){disposed=true;listeners.abort();cancelAnimationFrame(frame);}};
}
