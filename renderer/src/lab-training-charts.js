const SVG_NS = 'http://www.w3.org/2000/svg';
const series = [
  {key:'mean_reward',title:'平均奖励',label:'本轮所有试跑的平均得分',color:'#70e1cb'},
  {key:'policy_loss',title:'策略 loss',label:'模型调整动作时的优化目标',color:'#e8bb77'},
  {key:'value_loss',title:'价值 loss',label:'模型预测后续奖励的误差',color:'#85b9ef'},
  {key:'headstand_max_hold_seconds',title:'连续倒立 · 本轮最长',label:'秒；本轮任一机器人达到的最长连续保持，目标 2 秒',color:'#a7e8bb',min:0,maxFloor:2},
  {key:'headstand_valid_percent',title:'姿态达标的时间占比',label:'%；本轮全部采样中，同时满足姿态、支撑和稳定条件的比例',color:'#aab9ff',min:0,max:100},
];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const format = (value,digits=5) => finite(value) ? value.toLocaleString('zh-CN',{maximumSignificantDigits:digits,useGrouping:false}) : '—';
function svgNode(tag,attrs={},text) {
  const node=document.createElementNS(SVG_NS,tag);
  for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
  if(text!==undefined)node.textContent=text;
  return node;
}

// Plot the selected job's recorded metrics. Missing values stay gaps, never zeros.
export function createTrainingCharts(container) {
  let job=null, rows=[], hover=null, fingerprint='', width=0;
  const abort=new AbortController(), charts=[];
  const on=(node,event,handler)=>node.addEventListener(event,handler,{signal:abort.signal});
  for(const spec of series) {
    const card=document.createElement('section');card.className='training-curve';card.dataset.metric=spec.key;
    card.style.setProperty('--curve-color',spec.color);
    const heading=document.createElement('div');heading.className='curve-heading';
    const name=document.createElement('div'),title=document.createElement('h3'),description=document.createElement('p');
    title.textContent=spec.title;description.textContent=spec.label;name.append(title,description);
    const current=document.createElement('div');current.className='curve-current';
    const value=document.createElement('output'),iteration=document.createElement('span');current.append(value,iteration);
    heading.append(name,current);
    const plot=document.createElement('div');plot.className='curve-plot';
    const svg=svgNode('svg',{role:'img',tabindex:'0','aria-label':spec.title,preserveAspectRatio:'none'});
    const empty=document.createElement('p');empty.className='curve-empty';
    plot.append(svg,empty);card.append(heading,plot);container.append(card);
    const chart={...spec,card,value,iteration,svg,empty,points:[],geometry:null,cursor:null};charts.push(chart);
    on(svg,'pointermove',event=>{
      if(!rows.length||!chart.geometry)return;
      const {left,plotWidth,minX,maxX,width}=chart.geometry,rect=svg.getBoundingClientRect();
      const localX=(event.clientX-rect.left)*width/rect.width;
      const target=minX+(localX-left)/plotWidth*(maxX-minX);
      hover=rows.reduce((best,row)=>Math.abs(row.iteration-target)<Math.abs(best.iteration-target)?row:best).iteration;
      inspect();
    });
    on(svg,'pointerleave',()=>{hover=null;inspect();});
    on(svg,'blur',()=>{hover=null;inspect();});
    on(svg,'keydown',event=>{
      if(!rows.length||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      let index=hover===null?rows.length-1:rows.findIndex(row=>row.iteration===hover);
      if(event.key==='Home')index=0;else if(event.key==='End')index=rows.length-1;
      else index=Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowLeft'?-1:1)));
      hover=rows[index].iteration;inspect();
    });
  }
  const posture=document.createElement('section');posture.className='posture-metrics';posture.hidden=true;
  const postureTitle=document.createElement('h3');postureTitle.textContent='先看它有没有真的稳住';
  const postureNote=document.createElement('p');postureNote.className='hint';postureNote.textContent='训练中的峰值来自所有试跑，可能只成功过一瞬间。最终仍需从站立出发，在三段独立测试的结尾各保持 2 秒。';
  const posturePlots=document.createElement('div');posturePlots.className='loss-charts';posturePlots.append(charts[3].card,charts[4].card);
  const breakdown=document.createElement('details');breakdown.className='reward-breakdown';breakdown.open=true;
  const breakdownTitle=document.createElement('summary');breakdownTitle.textContent='这一轮的分数从哪里来？';
  const breakdownNote=document.createElement('p');breakdownNote.className='hint';
  const breakdownTable=document.createElement('table');breakdownTable.setAttribute('aria-label','当前查看轮次的奖励分项');
  breakdown.append(breakdownTitle,breakdownNote,breakdownTable);posture.append(postureTitle,postureNote,posturePlots,breakdown);container.append(posture);
  const advanced=document.createElement('details');advanced.className='loss-details';
  const summary=document.createElement('summary');summary.textContent='深入了解：模型如何调整（loss）';
  const note=document.createElement('p');note.className='hint';note.textContent='策略 loss 用于调整动作，价值 loss 用于修正对未来奖励的预测。它们各有刻度，不能直接比较大小。';
  const losses=document.createElement('div');losses.className='loss-charts';losses.append(charts[1].card,charts[2].card);
  advanced.append(summary,note,losses);container.append(advanced);on(advanced,'toggle',()=>{if(advanced.open)render();});
  function draw(chart) {
    const {svg,key}=chart;
    const w=Math.max(250,svg.clientWidth||500),h=148,left=56,right=14,top=14,bottom=29;
    const points=rows.filter(row=>finite(row[key]));chart.points=points;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();chart.cursor=null;
    chart.card.dataset.points=points.length;
    chart.empty.hidden=points.length>0;
    chart.empty.textContent=!job?'开始训练后，这里会显示曲线。':rows.length?`此记录暂无${chart.title}数据。`:'等待第一轮训练数据…';
    svg.setAttribute('aria-label',`${chart.title}，${points.length} 轮有记录。左右方向键查看各轮数值。`);
    if(!points.length){chart.geometry=null;return;}
    const values=points.map(row=>row[key]),low=Math.min(...values),high=Math.max(...values);
    const padding=high>low?(high-low)*0.12:Math.max(Math.abs(low)*0.1,0.01);
    const minY=chart.min??(low-padding),maxY=chart.max??Math.max(chart.maxFloor??-Infinity,high+padding);
    const first=rows[0].iteration,last=rows.at(-1).iteration;
    const minX=first===last?first-0.5:first,maxX=first===last?last+0.5:last;
    const plotWidth=w-left-right,plotHeight=h-top-bottom;
    const x=n=>left+(n-minX)/(maxX-minX)*plotWidth,y=n=>top+(maxY-n)/(maxY-minY)*plotHeight;
    chart.geometry={left,plotWidth,minX,maxX,x,y,width:w};
    for(let tick=0;tick<3;tick++) {
      const value=minY+(maxY-minY)*tick/2,py=y(value);
      svg.append(svgNode('line',{x1:left,y1:py,x2:w-right,y2:py,class:'curve-grid'}));
      svg.append(svgNode('text',{x:left-8,y:py+4,'text-anchor':'end',class:'curve-tick'},format(value,3)));
    }
    const ticks=[...new Set([first,Math.round((first+last)/2),last])];
    for(const tick of ticks)svg.append(svgNode('text',{x:x(tick),y:h-10,'text-anchor':'middle',class:'curve-tick'},tick));
    svg.append(svgNode('text',{x:w-right,y:h-10,'text-anchor':'end',class:'curve-axis'},'轮'));
    let path='',gap=true;
    for(const row of rows) {
      if(!finite(row[key])){gap=true;continue;}
      path+=`${gap?'M':'L'}${x(row.iteration).toFixed(2)},${y(row[key]).toFixed(2)} `;gap=false;
    }
    svg.append(svgNode('path',{d:path.trim(),class:'curve-line',stroke:chart.color}));
    // Dots also make the first point and isolated values visible.
    for(const point of points)svg.append(svgNode('circle',{cx:x(point.iteration),cy:y(point[key]),r:points.length===1?3.5:1.8,fill:chart.color,class:'curve-point'}));
    chart.cursor=svgNode('g',{class:'curve-cursor'});svg.append(chart.cursor);
  }
  function inspect() {
    const row=hover===null?rows.at(-1):rows.find(row=>row.iteration===hover);
    breakdownTable.replaceChildren();
    const verified=row?.reward_breakdown_status==='verified'&&row.reward_components;
    breakdownTable.hidden=!verified;
    breakdownNote.textContent=verified?`第 ${row.iteration} 轮 · 每步平均贡献；各项与训练器扣分相加，等于该轮平均奖励。`
      :row?.reward_breakdown_status==='inconsistent'?'分项之和与实际奖励不一致，因此不展示分项。训练仍使用 reward_environment 的返回值。'
      :row?.reward_breakdown_status==='invalid'?'自定义分项函数未返回有效数据。训练仍使用 reward_environment 的返回值。'
      :'此记录没有可核对的奖励分项；旧训练数据不会补成 0。自定义脚本可提供 reward_components 函数。';
    if(verified){
      const labels={posture:'支撑与身体姿态',hold:'连续保持',progress:'首次翻转进展',body_contact:'躯干或腿部碰地',motion:'实际运动与关节范围',command:'指令幅度与突变'};
      for(const [key,value] of [...Object.entries(row.reward_components),['automatic_penalty',row.automatic_penalty]]){
        const tr=document.createElement('tr'),label=document.createElement('th'),amount=document.createElement('td');
        label.scope='row';label.textContent=key==='automatic_penalty'?'训练器额外扣分':labels[key]||key;
        amount.textContent=format(value,6);tr.append(label,amount);breakdownTable.append(tr);
      }
    }
    for(const chart of charts) {
      const value=row?.[chart.key];
      chart.value.textContent=format(value,hover===null?5:7);
      chart.value.dataset.value=finite(value)?value:'';
      chart.iteration.textContent=row?`第 ${row.iteration} 轮${hover===null?' · 最新':''}`:'尚无数据';
      chart.cursor?.replaceChildren();
      if(hover!==null&&chart.geometry&&finite(value)) {
        const {x,y}=chart.geometry;
        chart.cursor.append(svgNode('line',{x1:x(row.iteration),x2:x(row.iteration),y1:8,y2:119,class:'curve-crosshair'}));
        chart.cursor.append(svgNode('circle',{cx:x(row.iteration),cy:y(value),r:4,fill:chart.color,stroke:'#10202c','stroke-width':2}));
      }
    }
  }
  function render(){for(const chart of charts)draw(chart);inspect();}
  const resize=new ResizeObserver(()=>{const next=container.clientWidth;if(next&&next!==width){width=next;render();}});
  resize.observe(container);
  function update(next) {
    const key=JSON.stringify([next?.id,next?.settings?.task,next?.phase,next?.metrics]);
    if(key===fingerprint)return;
    if(next?.id!==job?.id)hover=null;
    fingerprint=key;job=next;
    posture.hidden=!['microduck-headstand','microduck-headstand-hold'].includes(job?.settings?.task);
    rows=(job?.metrics||[]).filter(row=>finite(row.iteration)&&row.iteration>=1).slice().sort((a,b)=>a.iteration-b.iteration);
    if(hover!==null&&!rows.some(row=>row.iteration===hover))hover=null;
    container.dataset.runId=job?.id||'';render();
  }
  update(null);
  return {update,dispose(){resize.disconnect();abort.abort();}};
}
