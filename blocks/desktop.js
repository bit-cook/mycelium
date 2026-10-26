// @nodule {"id":"desktop","name":"桌面","icon":"🖥️","version":1,"caps":["ui","apps"]}
'use strict';
// ↦ 借 hypha 的 离体运行时
// ↦ 借 ai 的 选模型
// ══════════ 自报 ══════════
// 桌面、窗口、小应用(孢子)都归它; 没有它, 内核自带的裸壳面板兜底(系统永远可操作)
// 数据 {"prefix": "app:", "label": "小应用(孢子)", "kind": "data", "edit": "apps.create"}
// 数据 {"prefix": "settings:ui.", "label": "桌面设置", "kind": "config"}
// 现在 ui.state
// 打开 apps.open
// ══════════ 技能 ══════════
// 只写猜不到的事实, 只有注释、不跑
// 【看和点】要看用户眼前有什么、替他点桌面上的东西时: 先 ui.state 看眼前是什么、有哪些东西(每样一个对象名)、
//   每类东西能做什么。再 ui.do {target, action, value}: target 用 ui.state 里的对象名(app:<id>、win:<窗>、
//   desk、desktop), action 用「能做」里列的名字, 带括号的要给 value。做完再 ui.state 看变化。
// 【写小应用】要新建或改小应用(孢子)时: apps.create {name, html} 存一个, apps.open {id} 开窗跑。
//   孢子跑在隔离窗里: 没有 colony、读不到本机存储, 要存东西就只在内存里; 它能经 mycelium.call 调宿主能力
//   (窗口里 globals.mycelium.call('ui.state') 这样), 过不了隔离窗的能力调用时会收到清楚的错。
// 【点选编辑】收到用户点选后「发给 agent」的卡片时: 卡片写着选择器和归属, 归属是块就改那块源码,
//   是 app:<id> 就 apps.update 它的代码。样式也可以直接写 settings:ui.skin({选择器: {属性: 值}}), 写完 ui.do {target:'desk', action:'重画'}。
// ══════════ 设计变量 ══════════
// 整个系统的设计变量归桌面块: 别的块照 var(--accent, 默认) 取, 这里一换它们跟着换
const 设计变量 = `:root{color-scheme:dark;--bg:#0b0d10;--bg-2:#12151a;--surface:rgba(255,255,255,.035);
--surface-hover:rgba(255,255,255,.07);--border:rgba(255,255,255,.09);--border-strong:rgba(255,255,255,.2);
--text:#e8ecf0;--text-muted:#9aa4ad;--accent:#7ee787;--accent-soft:rgba(126,231,135,.12);
--warn:#f5a623;--danger:#ff5757;--radius:10px;--mono:ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;
--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}`;
// ══════════ 状态 ══════════
const UI = {
  wins: new Map(),     // 'app:<id>' / '设置' / '口袋' / '示波器' → {el, 类, 帧?, 标题}
  apps: new Map(),     // 桌面上的孢子: id → {id, name, icon, html}
  皮肤: null,
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
const 新号 = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const 听 = (el, ev, fn, 捕) => { el.addEventListener(ev, fn, 捕); ctx.cleanup(() => el.removeEventListener(ev, fn, 捕)); };
const 下载 = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// ══════════ 应用登记 ══════════
// 孢子: 一段 HTML, 隔离窗里跑。改了发 mycelium:apps
const 应用 = {
  async 载() {
    UI.apps.clear();
    for (const e of await ctx.kv.list('app:')) {
      const a = e.value;
      if (a?.html) UI.apps.set(a.id, a);
    }
  },
  列: () => [...UI.apps.values()].map(a => ({ id: a.id, name: a.name, icon: a.icon || '📦',
    字节: a.html.length, 改于: a.at })),
  async 建({ name, html, icon }) {
    if (typeof html !== 'string' || !html.trim()) throw new Error('缺 html: 孢子的内容');
    const a = { id: 新号('sp-'), name: name || '未命名孢子', icon: icon || '📦', html, at: Date.now() };
    await ctx.kv.set('app:' + a.id, a);
    await 应用.载();
    return a;
  },
  async 改(id, html) {
    const a = UI.apps.get(id) || await ctx.kv.get('app:' + id);
    if (!a) throw new Error(`没有这个孢子: ${id}`);
    a.html = html; a.at = Date.now();
    await ctx.kv.set('app:' + id, a);
    await 应用.载();
    return a;
  },
};
// ══════════ 窗口 ══════════
const 窗 = {
  开(键, { 题, 宽 = 520, 高 = 400, 内容, 类 = '' } = {}) {
    if (UI.wins.has(键)) { 窗.前置(键); return UI.wins.get(键); }
    const el = document.createElement('div');
    el.className = 'u-win ' + 类;
    el.innerHTML = `<div class="u-bar"><span class="u-t">${esc(题 || 键)}</span><span class="u-sp"></span>
<button class="u-b" data-a="min" title="收起">–</button><button class="u-b" data-a="max" title="最大化">□</button>
<button class="u-b" data-a="close" title="关">✕</button></div><div class="u-body"></div>`;
    el.style.cssText = `width:${宽}px;height:${高}px`;
    const 桌 = $('#desk');
    桌.appendChild(el);
    const 身 = el.querySelector('.u-body');
    if (内容) 内容(身, el);
    const 记 = { el, 身, 键, 题: 题 || 键 };
    UI.wins.set(键, 记);
    // 拖动: 标题栏按住就能挪
    const 条 = el.querySelector('.u-bar');
    听(条, 'pointerdown', e => {
      if (e.target.closest('.u-b')) return;
      const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const 移 = ev => { el.style.left = Math.max(0, ev.clientX - dx) + 'px'; el.style.top = Math.max(0, ev.clientY - dy) + 'px'; };
      const 起 = () => { document.removeEventListener('pointermove', 移); document.removeEventListener('pointerup', 起); };
      document.addEventListener('pointermove', 移);
      document.addEventListener('pointerup', 起);
    });
    听(el, 'click', e => {
      const 钮 = e.target.closest('.u-b'); if (!钮) return;
      if (钮.dataset.a === 'close') 窗.关(键);
      if (钮.dataset.a === 'min') el.classList.toggle('u-min');
      if (钮.dataset.a === 'max') el.classList.toggle('u-max');
    });
    听(el, 'pointerdown', () => 窗.前置(键), true);
    任务栏();
    return 记;
  },
  关(键) {
    const w = UI.wins.get(键);
    if (!w) return false;
    if (w.帧) ctx.call('hypha.unmount', { frame: w.帧 }).catch(() => { });
    w.el.remove();
    UI.wins.delete(键);
    任务栏();
    return true;
  },
  前置(键) { [...UI.wins.values()].forEach(w => w.el.style.zIndex = w.键 === 键 ? 10 : 1); },
  全部: () => [...UI.wins.keys()],
};
// ══════════ 任务栏与桌面 ══════════
function 任务栏() {
  const 栏 = $('#dock');
  if (!栏) return;
  栏.innerHTML = [...UI.apps.values()].map(a =>
    `<button class="u-dock" data-app="${esc(a.id)}" title="${esc(a.name)}">${a.icon || '📦'}</button>`).join('')
    + `<span class="u-dsp"></span>`
    + ['设置', '口袋', '示波器', '模型'].map(k =>
      `<button class="u-dock" data-win="${k}" title="${k}">${k === '设置' ? '⚙' : k === '口袋' ? '🎒' : k === '示波器' ? '📈' : '🧠'}</button>`).join('');
}
// ══════════ 内置窗 ══════════
const 内置 = {
  模型(身) {
    // 借 ai 块的选模型小表: ai 不在跑时, 这份文件自带剪来的复制(照跑)
    let 表;
    try { 表 = 选模型; } catch (e) {
      身.innerHTML = `<div class="u-empty">选模型表要 ai 块在跑: ${esc(e.message)}</div>`;
      return;
    }
    Promise.resolve(表.挂(身, { 题: '选模型' }))
      .catch(e => { 身.innerHTML = `<div class="u-empty">选模型表没画出来: ${esc(e.message)}</div>`; });
  },
  设置(身) {
    // 内核的裸壳面板请进窗: 块管理、导入导出、改内核都走它(系统永远可操作)
    ctx.call('hypha.panel', { host: 身 })
      .catch(e => { 身.innerHTML = `<div class="u-empty">面板没画出来: ${esc(e.message)}</div>`; });
  },
  口袋(身) {
    // 口袋块在就请它(数据管理、归属守卫都在那边); 不在就用桌面自带的简版
    ctx.call('pocket.mount', { el: 身 }).catch(async () => {
      const 帽 = document.createElement('div');
      帽.innerHTML = `<div class="u-row"><input class="u-in" placeholder="搜数据前缀或键…" style="flex:1">
<button class="u-btn" data-a="snap">拍快照</button><button class="u-btn" data-a="list">列快照</button></div><div class="u-list"></div>`;
      身.appendChild(帽);
      const 列 = async (q = '') => {
        const 全 = await ctx.kv.list(''), 表 = 全.filter(e => !q || e.key.includes(q)).slice(0, 300);
        帽.querySelector('.u-list').innerHTML = 表.map(e => `<div class="u-item" data-k="${esc(e.key)}">
<span class="u-k">${esc(e.key)}</span><span class="u-v">${esc(JSON.stringify(e.value) ?? '').slice(0, 120)}</span>
<button class="u-btn" data-a="del">删</button></div>`).join('') || '<div class="u-empty">没有数据</div>';
      };
      听(帽, 'click', async e => {
        const 钮 = e.target.closest('button'); if (!钮) return;
        try {
          if (钮.dataset.a === 'snap') { await ctx.call('hypha.snapshot', { name: 新号('snap-') }); await 列(); }
          if (钮.dataset.a === 'list') {
            const 快照 = await ctx.call('hypha.snapshots');
            帽.querySelector('.u-list').innerHTML = 快照.map(s =>
              `<div class="u-item"><span class="u-k">${esc(s.name)}</span>
<span class="u-v">${new Date(s.at).toLocaleString()} · ${s.n} 键</span>
<button class="u-btn" data-a="back" data-n="${esc(s.name)}">回滚到这</button></div>`).join('')
              + `<div class="u-item"><button class="u-btn" data-a="all">返回数据列表</button></div>`;
          }
          if (钮.dataset.a === 'back') { await ctx.call('hypha.snapshot', { name: 钮.dataset.n, restore: true }); await 列(); }
          if (钮.dataset.a === 'all') await 列();
          if (钮.dataset.a === 'del') {
            const k = 钮.closest('.u-item').dataset.k;
            if (confirm(`删 ${k}?`)) { await ctx.kv.del(k); await 列(); }
          }
        } catch (err) { alert(err.message); }
      });
      听(帽.querySelector('input'), 'input', e => 列(e.target.value.trim()));
      列();
    });
  },
  示波器(身) {
    const 帽 = document.createElement('div');
    帽.innerHTML = `<div class="u-row"><span class="u-muted">能力调用记录(最近 100 条)</span></div><div class="u-list"></div>`;
    身.appendChild(帽);
    const 列 = async () => {
      const 痕 = await ctx.call('hypha.trace', { limit: 100 });
      帽.querySelector('.u-list').innerHTML = 痕.reverse().map(s => `<div class="u-item">
<span class="u-k">${esc(s.path)}</span><span class="u-v">${esc(s.by)} · ${s.ms}ms · ${s.ok ? '✓' : '✗ ' + esc(s.err || '')}</span>
</div>`).join('') || '<div class="u-empty">还没有调用</div>';
    };
    列();
    ctx.on('mycelium:span', 列);
  },
};
// ══════════ 开孢子 ══════════
async function 开孢子(id) {
  const a = UI.apps.get(id) || await ctx.kv.get('app:' + id);
  if (!a) throw new Error(`没有这个孢子: ${id}`);
  const w = 窗.开('app:' + id, { 题: (a.icon || '📦') + ' ' + a.name, 宽: 640, 高: 480 });
  if (w.帧) return w;
  try {
    const f = await ctx.call('hypha.mount', {
      code: a.html, host: w.身, context: { sporeId: id },
    });
    w.帧 = f.dataset.mycApp;
  } catch (e) {
    w.身.innerHTML = `<div class="u-empty">孢子没跑起来: ${esc(e.message)}</div>`;
  }
  return w;
}
// ══════════ 点选 ══════════
// 用户在桌面上划一片, 把那片的 HTML 连选择器一起发给 agent(卡片写着归属, agent 好改)
const 点选 = {
  开: false,
  始() {
    点选.开 = true;
    document.body.style.cursor = 'crosshair';
    $('#pick-tip').hidden = false;
  },
  止() {
    点选.开 = false;
    document.body.style.cursor = '';
    $('#pick-tip').hidden = true;
  },
};
// ══════════ 桌面 ══════════
const 桌面 = {
  样式: 设计变量 + `
#desk{position:fixed;inset:0;bottom:44px;overflow:hidden}
.u-win{position:absolute;left:80px;top:60px;background:var(--bg-2);border:1px solid var(--border);
  border-radius:var(--radius);box-shadow:0 12px 40px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden}
.u-win.u-max{left:0!important;top:0!important;width:100%!important;height:100%!important}
.u-win.u-min .u-body{display:none}
.u-bar{display:flex;align-items:center;gap:6px;padding:7px 10px;background:var(--surface);
  border-bottom:1px solid var(--border);cursor:move;user-select:none}
.u-t{font-size:12px;font-weight:600}.u-sp{flex:1}
.u-b{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:2px 6px;border-radius:4px}
.u-b:hover{background:var(--surface-hover);color:var(--text)}
.u-body{flex:1;overflow:auto;position:relative}
#dock{position:fixed;left:0;right:0;bottom:0;height:44px;display:flex;align-items:center;gap:6px;
  padding:0 12px;background:var(--bg-2);border-top:1px solid var(--border);z-index:100}
.u-dock{background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;
  padding:5px 10px;cursor:pointer;font-size:14px}
.u-dock:hover{border-color:var(--accent);color:var(--accent)}
.u-dsp{flex:1}
.u-row{display:flex;gap:8px;align-items:center;padding:10px}
.u-in{background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px}
.u-btn{background:var(--accent-soft);border:1px solid rgba(126,231,135,.35);color:var(--accent);
  border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer}
.u-list{padding:0 10px 10px;font-size:12px}
.u-item{display:flex;gap:8px;align-items:center;padding:5px 8px;border:1px solid var(--border);border-radius:6px;margin:4px 0}
.u-k{font-family:var(--mono);font-size:11px;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
.u-v{flex:1;color:var(--text-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.u-empty{color:var(--text-muted);font-size:12px;padding:16px;text-align:center}
.u-muted{color:var(--text-muted);font-size:11px}
#pick-tip{position:fixed;left:12px;bottom:56px;background:var(--warn);color:#1a1a1a;font-size:12px;
  padding:6px 12px;border-radius:8px;z-index:200}
#agent-dock{position:fixed;right:12px;bottom:52px;width:380px;height:480px;background:var(--bg-2);
  border:1px solid var(--border);border-radius:var(--radius);z-index:90;display:none;flex-direction:column;overflow:hidden}
#agent-dock.in{display:flex}`,
  画() {
    const 样式 = document.createElement('style');
    样式.textContent = 桌面.样式;
    document.head.appendChild(样式);
    const 桌 = document.createElement('div');
    桌.id = 'desk';
    桌.innerHTML = `<div id="pick-tip" hidden>点选模式: 点桌面上的东西, 连它的 HTML 一起发给 agent(Esc 退出)</div>`;
    document.body.appendChild(桌);
    const 坞 = document.createElement('div');
    坞.id = 'dock';
    document.body.appendChild(坞);
    const 代 = document.createElement('div');
    代.id = 'agent-dock';
    document.body.appendChild(代);
    ctx.cleanup(() => { 桌.remove(); 坞.remove(); 代.remove(); 样式.remove(); });
    // 桌面点选: 点中的元素连选择器一起进卡片
    听(桌, 'click', e => {
      if (!点选.开) return;
      const el = e.target.closest('[data-block-id],[data-spore],.u-win') || e.target;
      const 择 = el.dataset.blockId ? `[data-block-id="${el.dataset.blockId}"]`
        : el.dataset.spore ? `[data-spore="${el.dataset.spore}"]` : (el.id ? '#' + el.id : el.className);
      ctx.call('agent.attach', { name: '点选的 ' + (el.tagName || '').toLowerCase(),
        text: `选择器: ${择}\n归属: ${el.dataset.blockId ? '块 ' + el.dataset.blockId : el.dataset.spore ? '孢子 ' + el.dataset.spore : '桌面'}\n` + el.outerHTML.slice(0, 4000) })
        .then(() => { 点选.止(); }).catch(() => { });
    });
    听(document, 'keydown', e => { if (e.key === 'Escape') 点选.止(); });
    听(坞, 'click', e => {
      const 钮 = e.target.closest('button'); if (!钮) return;
      if (钮.dataset.app) 开孢子(钮.dataset.app).catch(err => alert(err.message));
      if (钮.dataset.win) {
        const k = 钮.dataset.win;
        if (UI.wins.has(k)) 窗.前置(k);
        else 窗.开(k, { 题: k, 宽: k === '设置' ? 620 : 480, 高: 460, 内容: 内置[k] });
      }
    });
    任务栏();
    return true;
  },
};
// ══════════ 给 agent 的界面能力 ══════════
// ui.state 看眼前, ui.do 动手: 目标用对象名(app:<id>、win:<键>、desk、desktop), 动作照「能做」
ctx.provide('ui.state', () => ({
  桌面: { 对象: 'desk', 能做: ['重画', '点选模式'] },
  窗: 窗.全部().map(k => {
    const w = UI.wins.get(k);
    return { 对象: 'win:' + k, 题: w.题, 收起: w.el.classList.contains('u-min'), 帧: w.帧 || null,
      能做: ['前置', '关', '收起', '最大化'] };
  }),
  孢子: [...UI.apps.values()].map(a => ({ 对象: 'app:' + a.id, 名: a.name, 图标: a.icon,
    开着: UI.wins.has('app:' + a.id), 字节: a.html.length, 能做: ['开', '改代码', '删'] })),
}), { desc: '看界面上有什么: 桌面、开着的窗、孢子, 每样一个对象名和能做的动作', schema: {} });
ctx.provide('ui.do', a => {
  const [类, 名] = String(a.target || '').split(':');
  const 值 = a.value;
  if (a.target === 'desk' || a.target === 'desktop') {
    if (a.action === '重画') { 任务栏(); return { ok: true }; }
    if (a.action === '点选模式') { 点选.开 ? 点选.止() : 点选.始(); return { ok: true, 开: 点选.开 }; }
  }
  if (类 === 'app') {
    if (a.action === '开') return 开孢子(名).then(() => ({ ok: true }));
    if (a.action === '删') return ctx.kv.del('app:' + 名).then(() => 应用.载()).then(() => ({ ok: true }));
  }
  if (类 === 'win') {
    const w = UI.wins.get(名);
    if (!w) throw new Error(`没有开着的窗: ${a.target}(用 ui.state 看有哪些)`);
    if (a.action === '前置') { 窗.前置(名); return { ok: true }; }
    if (a.action === '关') return { ok: 窗.关(名) };
    if (a.action === '收起') { w.el.classList.toggle('u-min'); return { ok: true }; }
    if (a.action === '最大化') { w.el.classList.toggle('u-max'); return { ok: true }; }
  }
  throw new Error(`不会对 ${a.target} 做 ${a.action}(能用什么看 ui.state)`);
}, { desc: '对界面上的东西做动作: target 用 ui.state 里的对象名, action 用它「能做」里的名字',
  schema: { target: { type: 'string', description: '对象名' }, action: { type: 'string' }, value: {} } });
ctx.provide('apps.list', () => 应用.列(), { desc: '小应用(孢子)清单', schema: {} });
ctx.provide('apps.create', a => 应用.建(a), { desc: '建一个小应用(孢子): 一段 HTML, 隔离窗里跑',
  schema: { name: { type: 'string' }, html: { type: 'string' }, icon: { type: 'string' } } });
ctx.provide('apps.open', a => 开孢子(a.id).then(() => ({ ok: true })), { desc: '开一个小应用的窗',
  schema: { id: { type: 'string' } } });
ctx.provide('apps.update', a => 应用.改(a.id, a.html).then(() => ({ ok: true })), { desc: '改一个小应用的代码',
  schema: { id: { type: 'string' }, html: { type: 'string' } } });
ctx.provide('ui.host', () => true, { desc: '本块在跑: 有桌面(内核因此不挂兜底面板)', schema: {} });
// ══════════ 装配 ══════════
(async () => {
  await 应用.载();
  if (ctx.root) {
    // 桌面画不上不耽误能力(ui.state/ui.do/apps.* 照常)
    try {
      桌面.画();
      // 用户自己的孢子默认铺在桌面上: 拖 HTML 文件进来也能建
      听(document, 'dragover', e => e.preventDefault());
      听(document, 'drop', async e => {
        e.preventDefault();
        const 文 = e.dataTransfer?.files?.[0];
        if (!文) return;
        const html = await 文.text();
        const a = await 应用.建({ name: 文.name.replace(/\.html?$/, ''), html });
        await 开孢子(a.id);
      });
      ctx.on('mycelium:apps', 任务栏);
    } catch (e) { ctx.log('桌面没画出来(能力照常用):', e.message); }
  }
})();
return {};
