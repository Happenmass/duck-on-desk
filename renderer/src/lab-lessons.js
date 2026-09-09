const concepts={
  environment:'环境是它练习的地方：模拟地板、重力和身体。跌倒可以重来，不会操作实体机器人。',
  observation:'观察是模型收到的身体信息，例如速度、身体倾斜和关节角度。这些信息帮助它判断下一步。',
  action:'动作是模型发给关节的指令。这里有 14 路目标角度，合在一起形成站立、迈步和转向。',
  reward:'奖励是动作发生后得到的评分。接近目标速度、保持直立可以加分，跌倒、偏离方向和大动作可以扣分。',
  learning:'学习发生在收集一批经验之后：PPO 根据试跑和评分调整策略，再开始下一轮。这里会在基础行走策略上继续训练。',
};
export function createLessons({notice}) {
  const el=id=>document.getElementById(id);
  let currentTask='microduck-flat-walk';
  const describe=key=>currentTask==='microduck-headstand-hold'&&key==='environment'?'这一课由环境提供接近头撑的初始姿态，并加入轻微速度扰动。之后由模型控制关节保持平衡，没有持续托举。':currentTask==='microduck-headstand-hold'&&key==='learning'?'先学会从接近倒立的位置保持平衡；后续再练从站立翻过去。初始化成倒立不算学会翻转。':currentTask==='microduck-flat-walk'?concepts[key]:key==='reward'?(['microduck-headstand','microduck-headstand-hold'].includes(currentTask)?'奖励检查头部支撑、全身姿态和实际关节运动；连续稳住才有保持奖励。此阶段不要求跳动或起身。':'奖励按 8 秒时间表鼓励翻转、倒立腾空和回到站立。分数高不等于动作已经完成。'):key==='learning'?'模型根据真实尝试和评分调整关节策略。倒立基础练习先学进入与保持，完整动作还需要后续训练。':concepts[key];
  function go(step){
    for(const button of document.querySelectorAll('[data-lesson]')){const active=Number(button.dataset.lesson)===step;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
    for(const page of document.querySelectorAll('[data-lesson-page]'))page.hidden=Number(page.dataset.lessonPage)!==step;
    document.querySelector('.lesson-panel').dataset.step=step;
  }
  for(const button of document.querySelectorAll('[data-lesson],[data-next]'))button.addEventListener('click',()=>go(Number(button.dataset.lesson??button.dataset.next)));
  for(const button of document.querySelectorAll('[data-concept]'))button.addEventListener('click',()=>{for(const item of document.querySelectorAll('[data-concept]'))item.classList.toggle('active',item===button);el('concept-detail').textContent=describe(button.dataset.concept);});
  for(const button of document.querySelectorAll('[data-quiz]'))button.addEventListener('click',()=>{el('quiz-feedback').hidden=false;el('quiz-feedback').textContent=button.dataset.quiz==='no'?'对。原地站着也能得分，所以还要奖励接近目标速度。':'不一定。站稳和向前走是两件事；只奖励站稳，原地不动也可能拿到高分。';});
  el('target-speed').addEventListener('input',()=>{const speed=Number(el('target-speed').value);el('target-speed-help').textContent=Number.isFinite(speed)?`${speed} 米 / 秒，也就是每秒前进约 ${(speed*100).toFixed(0)} 厘米。`:'';});
  for(const key of ['speed','upright','effort'])el(`reward-${key}`).addEventListener('input',()=>{el(`reward-${key}-value`).textContent=String(Number(el(`reward-${key}`).value));el('reward-builder-status').textContent='评分草稿已调整，点击按钮后才写入训练脚本。';});
  el('use-reward').addEventListener('click',()=>{
    const speed=Number(el('reward-speed').value),upright=Number(el('reward-upright').value),effort=Number(el('reward-effort').value);
    if (![speed,upright,effort].every(Number.isFinite)) {notice('奖励权重需要填写有效数字。',true);return;}
    el('reward').value=`def reward_environment(state, action, next_state):\n    """Lesson reward: track speed, stay upright and retain the initial heading."""\n    import torch\n    error = next_state['forward_velocity'] - next_state['target_speed']\n    tracking = torch.exp(-error.square() / 0.04)\n    upright = next_state['upright'].clamp(0, 1)\n    alive = (next_state['height'] > 0.06).float()\n    heading = next_state['heading_error']\n    turning = next_state['yaw_rate']\n    return (${speed} * tracking + ${upright} * upright + 0.5 * alive\n            - ${effort} * action.square().sum(-1)\n            - 5.0 * heading.square() - 0.02 * turning.square())\n`;
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
    '先练保持：已经接近倒立，怎样稳住？',
    '环境先把小鸭放到接近头撑的姿态，加入轻微扰动，再让模型接手。倾斜、身体碰地时允许用脚蹬地找回平衡，不因失稳重置。默认每 30 秒模拟时间回到近倒立初态重新练习；第 3 步可调整时间，填 0 可关闭定时重置。',
    '让每一次接近平衡，都有反馈。',
    '奖励身体接近竖直倒置、重心靠近支撑点与双脚离地；允许脚触地恢复，不单独扣脚触地分，连续稳住另外加分。不要求各关节摆成固定姿势。观察各项贡献与保持时间，而不只看总分。自定义奖励脚本仍可修改。',
    '观察它能保持多久，而不是翻得多高。',
    '使用与官方相同的网络结构，默认随机权重起步，让关节自行寻找平衡；也可切换官方步态权重作对照。参数尚未证明训练成功。MPS 已支持，CUDA 待实机验证。',
    '近倒立起步，结尾稳住 2 秒。',
    '原生仿真用 3 组小扰动，桌宠仿真再检查一段；每段 8 秒，中途不重置、不托举。结尾连续 2 秒满足头撑、腿抬高、重心和关节稳定才通过。通过保持课不代表学会翻转。',
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
    guideNodes.forEach((node,i)=>node.textContent=(isHold?['第 4 步 / 验收近倒立起步的保持能力','看保持','由环境提供近倒立初态，模型接手后试播 8 秒。','查平衡','结尾连续保持 2 秒；预置姿态不能算学会翻转。','下一阶段','保持通过后再练从站立进入，随后练恢复正立，最后才是街舞。','它是头部支撑还是身体躺地？保持时间有没有增加？先检查各项姿态，再决定如何调整。']:isHeadstand?['第 4 步 / 只验收倒立保持','看尝试','从站立开始试播，8 秒结束后停在当前姿态。','查支撑','排除倒地、短暂翻滚和腾空，检查连续保持 2 秒。','下一阶段','通过后再练恢复正立、站稳收尾；街舞后置。当前只保留为练习模型。','如果只学会趴下或倾斜，先调整进入倒立的探索方式；奖励升高不代表已经倒立。']:isAction?actionGuide:walkGuide)[i]);
    el('reward-script-status').textContent='这是本课的奖励草稿，切换课程会保留各自的修改。';
    el('rollback').hidden=isAction;el('active-policy').hidden=isAction;
  }
  return {go,setTask,update(job){const phase={preparing:job.preparation||'首次训练：正在准备模型与 Python 环境。',starting:'正在准备训练环境。',evaluating_baseline:'先记录训练前的表现，稍后用来对比。',training:`正在练习：已完成 ${job.metrics.at(-1)?.iteration||0} / ${job.settings?.iterations||'—'} 轮。`,evaluating_candidate:'练习结束，正在检验候选模型。',completed:'这次练习已完成。进入第 4 步，看看结果。',failed:'练习没有完成。请查看错误说明与训练环境。',cancelled:'这次练习已停止，可以调整设置后重试。'};el('lesson-run-message').textContent=job.phase==='failed'?`练习未完成：${job.error||'请检查训练环境与脚本。'}`:phase[job.phase]||job.phase;}};
}
