const concepts={
  environment:'环境是它练习的地方：模拟地板、重力和身体。行走课使用官方 mjlab（MuJoCo Warp）环境，含域随机化；跌倒可以重来，不会操作实体机器人。',
  observation:'观察是模型收到的身体信息，例如速度、身体倾斜和关节角度。这些信息帮助它判断下一步。',
  action:'动作是模型发给关节的指令。这里有 14 路目标角度，合在一起形成站立、迈步和转向。',
  reward:'奖励是动作发生后得到的评分。接近目标速度、保持直立可以加分，跌倒、偏离方向和大动作可以扣分。',
  learning:'学习发生在收集一批经验之后：PPO 根据试跑和评分调整策略，再开始下一轮。行走课直接运行官方 mjlab 训练环境和 PPO 配方，从随机权重开始复现官方步态。',
};
export function createLessons({notice}) {
  const el=id=>document.getElementById(id);
  let currentTask='microduck-flat-walk';
  const describe=key=>currentTask==='microduck-headstand-hold'&&key==='environment'?'这一课由环境提供接近头撑的初始姿态，并从翻倒过程的随机时刻起步。之后由模型控制关节，倒下也不重置，没有持续托举。':currentTask==='microduck-headstand-hold'&&key==='learning'?'先学会掉下去之后用脚蹬回来，让头部中心重新贴地；后续再练从站立翻过去。初始化成倒立不算学会翻转。':currentTask==='microduck-headstand-hold'&&key==='reward'?'奖励身体转到头朝下、头部中心贴地，朝这个方向转动的过程也加分。脚触地不扣分，没有保持计时器。':currentTask==='microduck-flat-walk'?concepts[key]:key==='reward'?(['microduck-headstand','microduck-headstand-hold'].includes(currentTask)?'奖励检查头部支撑、全身姿态和实际关节运动；连续稳住才有保持奖励。此阶段不要求跳动或起身。':'奖励按 8 秒时间表鼓励翻转、倒立腾空和回到站立。分数高不等于动作已经完成。'):key==='learning'?'模型根据真实尝试和评分调整关节策略。倒立基础练习先学进入与保持，完整动作还需要后续训练。':concepts[key];
  function go(step){
    for(const button of document.querySelectorAll('[data-lesson]')){const active=Number(button.dataset.lesson)===step;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
    for(const page of document.querySelectorAll('[data-lesson-page]'))page.hidden=Number(page.dataset.lessonPage)!==step;
    document.querySelector('.lesson-panel').dataset.step=step;
  }
  for(const button of document.querySelectorAll('[data-lesson],[data-next]'))button.addEventListener('click',()=>go(Number(button.dataset.lesson??button.dataset.next)));
  for(const button of document.querySelectorAll('[data-concept]'))button.addEventListener('click',()=>{for(const item of document.querySelectorAll('[data-concept]'))item.classList.toggle('active',item===button);el('concept-detail').textContent=describe(button.dataset.concept);});
  for(const button of document.querySelectorAll('[data-quiz]'))button.addEventListener('click',()=>{el('quiz-feedback').hidden=false;el('quiz-feedback').textContent=button.dataset.quiz==='no'?'对。原地站着也能得分，所以还要奖励接近目标速度。':'不一定。站稳和向前走是两件事；只奖励站稳，原地不动也可能拿到高分。';});
  el('target-speed').addEventListener('input',()=>{const speed=Number(el('target-speed').value);el('target-speed-help').textContent=Number.isFinite(speed)?`${speed} 米 / 秒，也就是每秒前进约 ${(speed*100).toFixed(0)} 厘米。官方训练随机采样 −0.4～0.4 米/秒的速度指令，这个值只用于训练前后的对比测试。`:'';});
  for(const key of ['speed','upright','effort'])el(`reward-${key}`).addEventListener('input',()=>{el(`reward-${key}-value`).textContent=String(Number(el(`reward-${key}`).value));el('reward-builder-status').textContent='评分草稿已调整，点击按钮后才写入训练脚本。';});
  el('use-reward').addEventListener('click',()=>{
    const speed=Number(el('reward-speed').value),upright=Number(el('reward-upright').value),effort=Number(el('reward-effort').value);
    if (![speed,upright,effort].every(Number.isFinite)) {notice('奖励权重需要填写有效数字。',true);return;}
    el('reward').value=`# 官方 mjlab 奖励权重：只列出要修改的项，其余沿用官方默认。\nreward_weights = {\n    'track_linear_velocity': ${speed},\n    'upright': ${upright},\n    'action_rate_l2': ${-effort},   # 写出后不再按官方课程表自动加大\n}\n`;
    el('reward-script-status').textContent='已从评分参数生成奖励草稿，下一次训练会使用下方脚本。';
    el('reward-builder-status').textContent='已写入下方脚本，下一次训练会使用它。';notice('评分规则已写入奖励脚本，下一次训练生效。');
  });
  el('reward').addEventListener('input',()=>{
    el('reward-builder-status').textContent='你正在使用手写脚本；上方评分参数不会自动覆盖它。';
    el('reward-script-status').textContent='奖励草稿已修改。下一次开始训练时使用；正在运行的任务不受影响。';
  });
  el('edit-reward').addEventListener('click',()=>{
    go(1);el('reward').focus({preventScroll:true});el('reward-editor').scrollIntoView({block:'start'});
  });
  const copyNodes=[...document.querySelectorAll('[data-lesson-page] > h2, [data-lesson-page] > .lesson-copy')];
  const walkCopy=copyNodes.map(node=>node.textContent);
  const actionCopy=[
    '让它从站立出发，倒立跳动，再站回来。',
    '这一课探索倒立跳街舞。Microduck 没有手臂，需要靠头部与身体协调支撑。每次尝试都从站立开始，完整动作时长 8 秒。当前模板尚未训练成功。',
    '动作的不同阶段，需要不同的评分。',
    '前半段鼓励翻身倒立，中间鼓励倒立时离地跳动，最后鼓励回到站立。仍需实际观察支撑方式和动作是否自然；这些条件只是第一道验收。',
    '先跑一轮，观察它卡在哪个阶段。',
    '这是高难度动作的探索参数，不是已验证的成功配方。先保留默认值观察真实尝试，再修改一项奖励。MPS 和 CUDA 共用训练代码，CUDA 仍待实机验证。',
    '检查整段动作，再加入桌宠。',
    '训练端要在 3 个初始扰动下完成动作；桌宠仿真还会再测一段。倒立至少 0.4 秒、倒立腾空并落回至少 1 次、最后持续站稳 0.4 秒，才开放添加。通过后仍要目视检查动作是否符合你的预期。',
  ];
  const headstandCopy=[
    '先学会翻转进入倒立，保持稳定。',
    '每次从站立开始，在 8 秒内尝试把身体翻转过来，用头部支撑，让双脚离地。此阶段只练倒立保持，尚不是可加入桌宠的完整动作。',
    '倒立得更稳，就持续加分。',
    '除了身体朝向，还检查头部支撑、双脚相对身体的位置、重心和实际关节运动。横躺或反复翻滚不能持续领取翻转分；稳住越久，保持奖励越高。',
    '先观察它能不能进入倒立。',
    '这是倒立基础练习的探索参数，尚未验证成功。先检查最长连续保持时间，再决定调整奖励还是增加训练。MPS 已支持，CUDA 待实机验证。',
    '连续保持 2 秒，才算通过这一阶段。',
    '每次从站立出发，结尾连续 2 秒头部支撑、双脚在身体上方、躯干不躺地，重心与关节稳定。原生 3 段与桌宠仿真各自检查。此阶段不要求跳动或站回原位。',
  ];
  const holdCopy=[
    '先练循环：倒下去，再用脚蹬回来。',
    '环境先把小鸭放到接近头撑的姿态，再让模型接手。倒下不重置，允许用脚蹬地把身体转回来、让头部中心重新贴地。默认每 2.4 秒回到起始姿态重练，并从翻倒过程的随机时刻起步；第 3 步可调整这个时间。',
    '奖励身体转到头朝下，而不是奖励一动不动。',
    '按身体倒置程度的三次方计分，头部中心贴地再加权；朝倒立方向转动的过程本身就加分。脚触地不扣分——脚正是用来蹬回去的。身体躺地扣分。不设保持计时器，也不惩罚角速度。自定义奖励脚本仍可修改。',
    '看它掉下去之后回不回得来。',
    '使用与官方相同的网络结构，默认随机权重起步。探索噪声按 4 个控制步保持不变，便于出现连贯的蹬地动作。参数尚未证明训练成功。MPS 已支持，CUDA 待实机验证。',
    '头部贴地时间够长，而且掉下去能回来。',
    '原生仿真 3 段、桌宠仿真 1 段，每段 8 秒，中途不重置、不托举。统计头朝下贴地的时间占比、躺地占比和回到头部贴地的次数。当前阈值参照规划器可达的 88% 头下时间设为暂定值，尚未由训练验证。',
  ];
  const guideNodes=[...document.querySelectorAll('.result-instructions b, .result-instructions span, [data-lesson-page="3"] .lesson-kicker, [data-lesson-page="3"] .lesson-question p')];
  const walkGuide=guideNodes.map(node=>node.textContent);
  const actionGuide=['第 4 步 / 分数之外，还要检查完整动作','看动作','试播会自动从站立开始，观察它实际做了什么。','查完整性','检查倒立、腾空落地和最后站稳。','再添加','加入独立动作库，随时可以移出。','它卡在站立、翻身、腾空，还是收尾？下一次针对一个阶段调整奖励或补充示范，不要只增加训练轮数。'];
  function setTask(task) {
    currentTask=task;el('concept-detail').textContent=describe(document.querySelector('[data-concept].active')?.dataset.concept||'environment');
    const isHold=task==='microduck-headstand-hold',isHeadstand=isHold||task==='microduck-headstand',isAction=isHeadstand||task==='microduck-headstand-dance';
    for(const node of document.querySelectorAll('[data-walk-only]'))node.hidden=isAction;
    for(const node of document.querySelectorAll('[data-action-only]'))node.hidden=!isAction;
    for(const node of document.querySelectorAll('[data-dance-only]'))node.hidden=!isAction||isHeadstand;
    for(const node of document.querySelectorAll('[data-headstand-only]'))node.hidden=!isHeadstand;
    for(const node of document.querySelectorAll('[data-hold-only]'))node.hidden=!isHold;
    for(const node of document.querySelectorAll('[data-entry-only]'))node.hidden=task!=='microduck-headstand';
    copyNodes.forEach((node,i)=>node.textContent=(isHold?holdCopy:isHeadstand?headstandCopy:isAction?actionCopy:walkCopy)[i]);
    guideNodes.forEach((node,i)=>node.textContent=(isHold?['第 4 步 / 验收倒立循环','看循环','由环境提供近倒立初态，模型接手后试播 8 秒。','查恢复','看头部贴地的时间占比，以及掉下去之后回来的次数。','下一阶段','循环稳定后再练从站立进入，随后练恢复正立，最后才是街舞。','它是掉下去就躺着不动，还是能用脚蹬回来？先看躺地占比，再看恢复次数。']:isHeadstand?['第 4 步 / 只验收倒立保持','看尝试','从站立开始试播，8 秒结束后停在当前姿态。','查支撑','排除倒地、短暂翻滚和腾空，检查连续保持 2 秒。','下一阶段','通过后再练恢复正立、站稳收尾；街舞后置。当前只保留为练习模型。','如果只学会趴下或倾斜，先调整进入倒立的探索方式；奖励升高不代表已经倒立。']:isAction?actionGuide:walkGuide)[i]);
    el('reward-script-status').textContent='这是本课的奖励草稿，切换课程会保留各自的修改。';
    el('rollback').hidden=isAction;el('active-policy').hidden=isAction;
  }
  return {go,setTask,update(job){const phase={preparing:job.preparation||'首次训练：正在准备模型与 Python 环境。',starting:'正在准备训练环境。',evaluating_baseline:'先记录训练前的表现，稍后用来对比。',training:`正在练习：已完成 ${job.metrics.at(-1)?.iteration||0} / ${job.settings?.iterations||'—'} 轮。`,evaluating_candidate:'练习结束，正在检验候选模型。',completed:'这次练习已完成。进入第 4 步，看看结果。',failed:'练习没有完成。请查看错误说明与训练环境。',cancelled:'这次练习已停止，可以调整设置后重试。'};el('lesson-run-message').textContent=job.phase==='failed'?`练习未完成：${job.error||'请检查训练环境与脚本。'}`:phase[job.phase]||job.phase;}};
}
