import officialScript from '../../mcp/robot-lab/training/roulade-official-reward.py?raw';

// Display data is derived from the same annotated template the backend submits.
// Never execute user Python in the browser; complex expressions stay in the editor.
export function createRouladeRewardGuide(editor) {
  const guide = document.createElement('details');
  guide.className = 'action-reward-guide'; guide.open = true; guide.hidden = true;
  const title = document.createElement('summary'); title.textContent = '前滚翻评分对照 · 配置名与中文作用';
  const note = document.createElement('p'); note.className = 'hint';
  note.textContent = '下表是官方基线初始值，不是实时分数或修改后的草稿。实际训练使用下方脚本。动态项的全部阶段在 reward_schedules 中；权重正负须结合原始评分理解。';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const label of ['配置名', '官方初始权重', '作用 / 调整对象']) { const cell = document.createElement('th'); cell.textContent = label; head.append(cell); }
  const body = table.createTBody();
  for (const match of officialScript.matchAll(/^\s*'([^']+)':\s*(-?[\d.]+),\s*#\s*(.+)$/gm)) {
    const row = body.insertRow();
    for (const value of match.slice(1)) row.insertCell().textContent = value;
  }
  const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = '将完整官方配置填入编辑器';
  restore.onclick = () => {
    if (editor.value.trim() && !window.confirm('将覆盖当前奖励草稿，恢复完整官方权重与课程表。继续吗？')) return;
    editor.value = officialScript; editor.dispatchEvent(new Event('input', {bubbles: true}));
  };
  guide.append(title, note, table, restore); editor.closest('section').before(guide);
  return {setTask(task) {guide.hidden = task !== 'microduck-roulade';}};
}
