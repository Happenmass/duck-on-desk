import './market.css';

// Everything rendered here -- titles, descriptions, task names -- is text an
// arbitrary Hub author wrote. It is only ever written through textContent; no
// listing string is ever parsed as markup.
const el = (id) => document.getElementById(id);

const request = async (action, payload) => {
  const result = window.marketAPI
    ? await window.marketAPI.request(action, payload)
    : await (await fetch('/__market/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      })).json();
  if (result && result.error) throw new Error(result.error);
  return result;
};

const STATUS_LABEL = {
  ready: '可直接使用',
  manual: '需要手动映射',
  unverifiable: '未声明契约',
  incompatible: '不兼容',
};

// Why an entry landed where it did, in the user's terms rather than the field name.
const REASON_TEXT = {
  'no-manifest': '这个仓库没有 manifest.json，无法确认它的输入输出约定。需要在实验室里实测才能判断。',
  'model-api-missing': '作者没有声明 model_api，无法确认它遵循哪一版约定。需要在实验室里实测才能判断。',
  'model-api-unsupported': '这个仓库声明了本应用尚未支持的 model_api 版本。可以下载观察，但不能按已知约定驱动。',
  'command-semantics-unknown': '它的指令槽位含义由作者自定义，与桌宠的行走指令不是同一套。直接驱动会做出不可预期的动作。',
  'episodic-command-unknown': '这是有时长的动作，但作者没有声明空闲指令向量，因此不能假定播放期间该喂零。',
  'foreign-morphology': '这是高跷、滚轮一类改装形态的策略，与桌宠当前的普通脚身体不匹配。',
  'body-variant': '作者标注了不同的机身版本（例如整壳），碰撞模型与桌宠仿真不一致。',
  'no-policy-file': '仓库里没有 policy.onnx，没有可运行的权重。',
  'no-revision': '无法确定这个仓库的提交版本，不能固定到一个不可变的快照。',
  'other-robot': '这是给另一种机器人训练的策略。',
  'observation-size': '它声明的观测长度与桌宠的 61 项不一致。',
  'action-size': '它声明的输出路数与桌宠的 14 路关节不一致。',
  'control-rate': '它声明的控制频率与桌宠的 50 Hz 不一致。',
};

const READY_TEXT = {
  'zero-commands': '这是一段有固定时长的动作，作者声明空闲指令为全零，桌宠播放时只需持续送零——与本机已有动作走同一条路径。下载后可在实验室试播，确认后加入桌宠动作库。',
  velocity: '它的前三个指令槽位是速度三元组，与桌宠的行走指令语义一致。这是持续步态，不是一段动作：下载后可以在实验室里当作行走策略试用，但目前还不能替换桌宠的行走策略。',
};

// What a downloaded policy can actually do, said before the download rather
// than discovered after it.
const NEXT_STEP = {
  'zero-commands': '下载后去实验室试播，满意再加入桌宠。',
  velocity: '下载后只能在实验室里作为行走策略试用，暂不能加入桌宠。',
};

let entries = [];
let installed = [];
let filter = 'all';
let selected = null;
let noticeTimer = 0;

function notice(message, isError = false) {
  const node = el('notice');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.hidden = true; }, 4200);
}

function badge(text, kind) {
  const span = document.createElement('span');
  span.className = `badge ${kind}`;
  span.textContent = text;
  return span;
}

function mediaNode(entry, { autoplay }) {
  if (entry.mediaUrl && /\.(mp4|webm)$/i.test(entry.mediaPath || '')) {
    const video = document.createElement('video');
    video.src = entry.mediaUrl;
    if (entry.posterUrl) video.poster = entry.posterUrl;
    video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'metadata';
    video.controls = !autoplay;
    if (autoplay) {
      // Only the hovered card plays: a grid of 30 looping clips is a GPU bill.
      video.addEventListener('mouseenter', () => { video.play().catch(() => {}); });
      video.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
    }
    return video;
  }
  if (entry.mediaUrl) {
    const image = document.createElement('img');
    image.src = entry.mediaUrl;
    image.alt = '';
    return image;
  }
  const placeholder = document.createElement('span');
  placeholder.className = 'placeholder';
  placeholder.textContent = 'NO PREVIEW';
  return placeholder;
}

function card(entry) {
  const button = document.createElement('button');
  button.className = 'card';
  button.type = 'button';

  const media = document.createElement('div');
  media.className = 'card-media';
  media.append(mediaNode(entry, { autoplay: true }));

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('div');
  title.className = 'card-title';
  const heading = document.createElement('h3');
  heading.textContent = entry.title;
  const owner = document.createElement('span');
  owner.className = 'card-owner';
  owner.textContent = entry.owner;
  title.append(heading, owner);

  const description = document.createElement('p');
  description.className = 'card-desc';
  description.textContent = entry.description || '作者未提供说明。';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(badge(STATUS_LABEL[entry.status] || entry.status, entry.status));
  if (entry.kind) meta.append(badge(entry.kind === 'episodic' ? `动作 ${entry.duration ?? '?'}s` : '持续步态', 'kind'));
  const local = installed.find((item) => item.repo === entry.repo && item.revision === entry.sha);
  if (local) meta.append(badge(local.state === 'admitted' ? '已加入桌宠' : '已下载', 'ready'));
  const stats = document.createElement('span');
  stats.textContent = `♥ ${entry.likes} · ↓ ${entry.downloads}`;
  meta.append(stats);

  body.append(title, description, meta);
  button.append(media, body);
  button.addEventListener('click', () => select(entry));
  if (selected && selected.repo === entry.repo) button.classList.add('selected');
  return button;
}

function row(list, term, value) {
  if (value === null || value === undefined || value === '') return;
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = String(value);
  list.append(dt, dd);
}

function select(entry) {
  selected = entry;
  const panel = el('detail');
  panel.textContent = '';
  panel.hidden = false;

  const close = document.createElement('button');
  close.className = 'close subtle';
  close.textContent = '关闭';
  close.addEventListener('click', () => { selected = null; panel.hidden = true; render(); });

  const heading = document.createElement('h2');
  heading.textContent = entry.title;
  const repo = document.createElement('div');
  repo.className = 'repo';
  repo.textContent = entry.repo;
  panel.append(close, heading, repo);

  if (entry.mediaUrl) {
    const section = document.createElement('section');
    section.append(mediaNode(entry, { autoplay: false }));
    panel.append(section);
  }

  if (entry.description) {
    const section = document.createElement('section');
    const h3 = document.createElement('h3');
    h3.textContent = 'DESCRIPTION';
    const p = document.createElement('p');
    p.textContent = entry.description;
    section.append(h3, p);
    panel.append(section);
  }

  const verdict = document.createElement('section');
  const verdictHeading = document.createElement('h3');
  verdictHeading.textContent = 'COMPATIBILITY';
  const why = document.createElement('div');
  why.className = entry.status === 'ready' ? 'why ready' : 'why';
  why.textContent = entry.status === 'ready'
    ? (READY_TEXT[entry.commandMode] || '契约已确认。')
    : (REASON_TEXT[entry.reason] || '无法确认它的运行约定。');
  verdict.append(verdictHeading, why);
  panel.append(verdict);

  const facts = document.createElement('section');
  const factsHeading = document.createElement('h3');
  factsHeading.textContent = 'DECLARED';
  const list = document.createElement('dl');
  row(list, '类型', entry.kind === 'episodic' ? '有限时长动作' : entry.kind === 'perpetual' ? '持续步态' : '未声明');
  row(list, '时长', entry.duration ? `${entry.duration} 秒` : null);
  row(list, '起始姿态', entry.entryPose);
  row(list, '训练任务', entry.task);
  row(list, '训练仓库', entry.trainingRepo);
  row(list, '许可证', entry.license);
  row(list, '提交', entry.sha ? entry.sha.slice(0, 12) : null);
  row(list, '更新于', entry.updatedAt ? entry.updatedAt.slice(0, 10) : null);
  facts.append(factsHeading, list);
  panel.append(facts);

  if (entry.knownLimits) {
    const section = document.createElement('section');
    const h3 = document.createElement('h3');
    h3.textContent = 'AUTHOR-DECLARED LIMITS';
    const p = document.createElement('p');
    p.textContent = entry.knownLimits;
    section.append(h3, p);
    panel.append(section);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const open = document.createElement('button');
  open.textContent = '在 Hugging Face 打开';
  open.addEventListener('click', async () => {
    try { await request('open-repository', { repo: entry.repo }); }
    catch (error) { notice(error.message, true); }
  });
  const installedEntry = installed.find((item) => item.repo === entry.repo && item.revision === entry.sha);
  if (entry.status === 'ready') {
    const download = document.createElement('button');
    const tryIt = document.createElement('button');
    tryIt.textContent = entry.commandMode === 'velocity' ? '去实验室试用' : '去实验室试播';
    tryIt.hidden = !installedEntry;
    download.className = installedEntry ? '' : 'primary';
    download.textContent = installedEntry
      ? (installedEntry.state === 'admitted' ? '已加入桌宠' : '已下载')
      : '下载';
    download.disabled = Boolean(installedEntry);
    if (!installedEntry) {
      download.addEventListener('click', async () => {
        download.disabled = true;
        download.textContent = '正在下载…';
        try {
          installed = await request('install', { repo: entry.repo, revision: entry.sha });
          notice(`已下载「${entry.title}」。${NEXT_STEP[entry.commandMode] || ''}`);
          select(entry);
        } catch (error) {
          download.disabled = false;
          download.textContent = '下载';
          notice(error.message, true);
        }
      });
    }
    tryIt.addEventListener('click', async () => {
      try {
        await request('open-lab', {});
        notice(entry.commandMode === 'velocity'
          ? '实验室已打开：在「桌宠动作库 → 来自动作商城」里点「作为行走策略试用」。'
          : '实验室已打开：在「桌宠动作库 → 来自动作商城」里试播，满意后再加入。');
      } catch (error) { notice(error.message, true); }
    });
    actions.append(download, tryIt, open);
  } else {
    actions.append(open);
  }
  panel.append(actions);

  render();
}

function render() {
  const grid = el('grid');
  grid.textContent = '';
  const visible = entries.filter((entry) => (filter === 'all' ? entry.status !== 'incompatible' : entry.status === filter));
  for (const entry of visible) grid.append(card(entry));
  el('empty').hidden = visible.length > 0;
  el('empty').textContent = visible.length > 0 ? '' : '这个分区暂时没有条目。';
}

function counts(map) {
  el('count-all').textContent = String(entries.filter((entry) => entry.status !== 'incompatible').length);
  for (const status of ['ready', 'manual', 'unverifiable']) el(`count-${status}`).textContent = String(map[status] || 0);
  el('total-count').textContent = String(entries.length);
}

async function load({ force = false } = {}) {
  el('refresh').disabled = true;
  el('market-status').textContent = force ? '正在刷新社区目录…' : '正在读取社区目录…';
  try {
    const [result, downloaded] = await Promise.all([request('list', { force }), request('installed', {})]);
    entries = Array.isArray(result.entries) ? result.entries : [];
    installed = Array.isArray(downloaded) ? downloaded : [];
    counts(result.counts || {});
    render();
    const when = result.fetchedAt ? new Date(result.fetchedAt).toLocaleString() : '未知时间';
    el('market-status').textContent = `${entries.length} 个仓库 · ${when}`;
    el('stale-note').hidden = !result.stale;
    if (result.stale) {
      el('stale-note').textContent = `无法连接 Hugging Face，下面显示的是 ${when} 缓存的目录，可能已经过时。（${result.error || '网络不可用'}）`;
    }
  } catch (error) {
    el('market-status').textContent = '读取失败';
    el('empty').hidden = false;
    el('empty').textContent = `无法读取社区目录：${error.message}`;
    notice(error.message, true);
  } finally {
    el('refresh').disabled = false;
  }
}

for (const button of document.querySelectorAll('#filters button')) {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    for (const other of document.querySelectorAll('#filters button')) {
      const active = other === button;
      other.classList.toggle('active', active);
      other.setAttribute('aria-selected', String(active));
    }
    render();
  });
}
el('refresh').addEventListener('click', () => load({ force: true }));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selected) { selected = null; el('detail').hidden = true; render(); }
});

load();
