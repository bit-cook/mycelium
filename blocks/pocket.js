// @nodule {"id":"pocket","name":"次元口袋","icon":"🎒","version":1,"caps":["data"]}
'use strict';
// ↦ 借 hypha 的 离体运行时
// ══════════ 自报 ══════════
// 看、搜、改、删存着的数据; agent 要动数据也经这里(守归属: 谁的前缀谁管)
// 数据 {"prefix": "settings:pocket.", "label": "口袋设置(连着的文件夹)", "kind": "config"}
// 数据 {"prefix": "media:", "label": "文件和笔记", "kind": "data"}
// 现在 data.own
// ══════════ 技能 ══════════
// 只写猜不到的事实, 只有注释、不跑
// 【动数据】要读、写、删系统里的数据时: data.list 看有哪些前缀, data.get 读, data.set 写, data.del 删。
//   写到别的块认领的前缀会被挡(归它管, 改它走它自报里写的 edit 能力)——那是为了不让两块互相盖。
//   真要绕过(比如整库搬迁)用 data.clean {key, force: true}。删人的东西前三思, 删了回不来(除非有快照)。
// 【连电脑文件夹】用户要把某个文件夹接进来时: pocket.pickFolder 让用户亲手选(浏览器要求必须人点),
//   之后 disk:<文件夹名>/<路径> 就是那个文件夹里的文件, data.get/list 照常用, data.set 写回去。
// ══════════ 归属 ══════════
// 谁的前缀谁管: 各块在「自报」段里写 数据 {prefix…}, 最长的前缀算数。写了 edit 的前缀,
// 只有主人(或没有主人在跑)能经口袋写。两块认同一个前缀: 谁都不能经口袋写(说清是谁)。
const 归属 = {
  表: [],
  async 载() {
    const bs = (colony.单独 ? [{ id: ctx.id, name: '次元口袋', about: {
      desc: '看、搜、改、删存着的数据', data: [{ prefix: 'settings:pocket.', label: '口袋设置', kind: 'config' }] } }]
      : await ctx.call('hypha.nodules')).filter(b => !b.broken);
    归属.表 = bs.flatMap(b => ((b.about || {}).data || []).filter(n => n?.prefix)
      .map(n => Object.assign({}, n, { owner: b.id, 块: b.name || b.id, running: b.running })))
      .concat([{ prefix: 'block:', label: '块的改版', owner: 'hypha', 块: 'Hypha', running: true,
        edit: 'hypha.setNodule' }])
      .sort((a, b) => b.prefix.length - a.prefix.length);
  },
  of: k => 归属.表.find(n => k.startsWith(n.prefix)),
  守(k, by, 删) {
    if (删 && by === ctx.id) return;                    // 人在口袋里亲手点的删: 不拦
    const n = 归属.of(k);
    if (!n) return;
    if (n.两家) throw Object.assign(new Error(`「${k}」两块都认(${n.两家.join('、')}), 经口袋谁都不能写`), { 人话: '两块都认它, 这里改不了' });
    if (n.edit && by !== n.owner && n.running)
      throw Object.assign(new Error(`「${k}」归${n.块}管, 改它走 ${n.edit}`), { 人话: `归「${n.块}」管, 这里改不了` });
  },
};
// ══════════ 数据 ══════════
// agent 和人都经这几个能力动数据; 写之前过归属守卫, 每次写留痕(journal)
ctx.provide('data.list', async a => {
  const 全 = await ctx.kv.list(a.prefix || '');
  return 全.filter(e => !e.key.startsWith('block:')).map(e => ({ key: e.key,
    值: JSON.stringify(e.value) ?? '', 字节: JSON.stringify(e.value)?.length || 0,
    归: 归属.of(e.key)?.块 || '(没人认领)' })).slice(0, a.limit || 500);
}, { desc: '列数据: 每项的键、值(JSON 摘要)、归哪块管; prefix 只要这个前缀', schema: {
  prefix: { type: 'string' }, limit: { type: 'number' } } });
ctx.provide('data.get', async a => {
  const v = await ctx.kv.get(a.key);
  if (v == null) throw new Error(`没有这个键: ${a.key}(用 data.list 看有哪些)`);
  return { key: a.key, value: v, 归: 归属.of(a.key)?.块 || '(没人认领)' };
}, { desc: '读一个键', schema: { key: { type: 'string', description: '键名' } } });
ctx.provide('data.set', async a => {
  归属.守(a.key, a.by || 'pocket');
  await ctx.kv.set(a.key, a.value);
  return { key: a.key, 字节: JSON.stringify(a.value)?.length || 0, 归: 归属.of(a.key)?.块 || '(没人认领, 已记在口袋名下)' };
}, { desc: '写一个键(值要能变 JSON); 归别的块管的前缀会被挡, 照提示走它的能力', schema: {
  key: { type: 'string', description: '键名' }, value: { description: '要存的值(能 JSON 化的都行)' },
  by: { type: 'string', description: '谁在写(挡归属时看)' } } });
ctx.provide('data.del', async a => {
  归属.守(a.key, a.by || 'pocket', true);
  await ctx.kv.del(a.key);
  return { key: a.key, 删了: true };
}, { desc: '删一个键(人在口袋里删不拦; agent 删归人的数据会被挡)', schema: {
  key: { type: 'string' }, by: { type: 'string' } } });
ctx.provide('data.own', async a => {
  await 归属.载();
  const n = 归属.of(a.key || '');
  return n ? { key: a.key, 归属: n.块, owner: n.owner, label: n.label, kind: n.kind,
    edit: n.edit || null, running: n.running } : { key: a.key, 归属: '(没人认领)' };
}, { desc: '一个键归哪块管、改它该走哪个能力', schema: { key: { type: 'string' } } });
ctx.provide('data.clean', async a => {
  if (!a.force) {
    const n = 归属.of(a.key);
    if (n && n.owner !== 'pocket') throw new Error(`「${a.key}」归${n.块}管, 要硬删给 force: true(想清楚)`);
  }
  await ctx.kv.del(a.key);
  return { key: a.key, 删了: true };
}, { desc: '硬删: 绕过归属守卫(整库搬迁、清理没人认领的数据用)', schema: {
  key: { type: 'string' }, force: { type: 'boolean' } } });
// ══════════ 口袋窗 ══════════
// 桌面块的「口袋」窗把这个挂进自己的窗体(pocket.mount); 没有桌面块时能力照常用
const 口袋 = {
  样式: `.pk{font:13px/1.6 -apple-system,"PingFang SC",sans-serif;color:var(--text,#e8ecf0);height:100%;display:flex;flex-direction:column}
.pk .row{display:flex;gap:8px;align-items:center;padding:10px}
.pk input{flex:1;background:rgba(255,255,255,.05);border:1px solid var(--border,rgba(255,255,255,.09));
  color:inherit;border-radius:6px;padding:5px 8px;font-size:12px}
.pk button{background:var(--accent-soft,rgba(126,231,135,.12));border:1px solid rgba(126,231,135,.35);
  color:var(--accent,#7ee787);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer}
.pk .list{flex:1;overflow:auto;padding:0 10px 10px}
.pk .item{display:flex;gap:8px;align-items:center;padding:5px 8px;border:1px solid var(--border,rgba(255,255,255,.09));
  border-radius:6px;margin:4px 0;font-size:12px}
.pk .k{font-family:var(--mono,monospace);font-size:11px;color:var(--accent,#7ee787);max-width:38%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk .v{flex:1;color:var(--text-muted,#9aa4ad);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk .own{font-size:10px;color:var(--text-muted,#9aa4ad);white-space:nowrap}
.pk .empty{color:var(--text-muted,#9aa4ad);text-align:center;padding:24px;font-size:12px}
.pk .edit{width:100%;min-height:120px;background:rgba(0,0,0,.3);border:1px solid var(--border);color:inherit;
  border-radius:6px;padding:8px;font-family:var(--mono,monospace);font-size:11px}`,
  async 挂(host) {
    const 听宿主 = (el, ev, fn) => { el.addEventListener(ev, fn); ctx.cleanup(() => el.removeEventListener(ev, fn)); };
    host.innerHTML = `<style>${口袋.样式}</style><div class="pk">
<div class="row"><input placeholder="搜键或值…"><button data-a="新">新键</button>
<button data-a="快照">拍快照</button><button data-a="文件夹">连文件夹</button></div>
<div class="list"></div></div>`;
    const 列 = async (q = '') => {
      const 全 = await ctx.kv.list(''), 表 = 全.filter(e => !q || e.key.includes(q)
        || JSON.stringify(e.value).includes(q)).slice(0, 300);
      host.querySelector('.list').innerHTML = 表.map(e => `<div class="item" data-k="${esc(e.key)}">
<span class="k">${esc(e.key)}</span>
<span class="v">${esc((JSON.stringify(e.value) ?? '').slice(0, 140))}</span>
<span class="own">${esc(归属.of(e.key)?.块 || '没人认领')}</span>
<button data-a="改">改</button><button data-a="删">删</button></div>`).join('')
        || '<div class="empty">没有数据</div>';
    };
    听宿主(host, 'click', async e => {
      const 钮 = e.target.closest('button'); if (!钮) return;
      const 项 = 钮.closest('.item'), k = 项?.dataset.k;
      try {
        if (钮.dataset.a === '新') {
          const 名 = prompt('新键的名字(前缀.名字):');
          if (!名) return;
          const 值 = prompt('值(JSON):', '{}');
          await ctx.kv.set(名, JSON.parse(值 || '{}'));
          await 列();
        }
        if (钮.dataset.a === '改' && k) {
          const v = await ctx.kv.get(k);
          const 值 = prompt(`改 ${k} 的值(JSON):`, JSON.stringify(v, null, 1));
          if (值 == null) return;
          await ctx.kv.set(k, JSON.parse(值));
          await 列();
        }
        if (钮.dataset.a === '删' && k) {
          if (!confirm(`删 ${k}?`)) return;
          await ctx.kv.del(k);
          await 列();
        }
        if (钮.dataset.a === '快照') { await ctx.call('hypha.snapshot', { name: 'snap-' + Date.now().toString(36) }); alert('拍好了, 设置窗里能回滚'); }
        if (钮.dataset.a === '文件夹') { await 磁盘.选(); }
      } catch (err) { alert(err.message); }
    });
    听宿主(host.querySelector('input'), 'input', e => 列(e.target.value.trim()));
    await 归属.载();
    await 列();
    ctx.on('mycelium:journal', () => { });
    return () => { host.innerHTML = ''; };
  },
};
ctx.provide('pocket.mount', a => 口袋.挂(a.el || a.host), { desc: '把口袋窗挂进 el(桌面的口袋窗用它)',
  schema: { el: {}, host: { type: 'string' } } });
// ══════════ 磁盘 ══════════
// 用户亲手选的文件夹: 键写 disk:<文件夹名>/<路径>。句柄存在库里(IndexedDB 能直接存句柄)
const 磁盘 = {
  async 选() {
    if (!window.showDirectoryPicker) throw new Error('这个浏览器不支持选文件夹(要 Chrome/Edge 86+)');
    const 柄 = await window.showDirectoryPicker();
    const 名 = 柄.name;
    await ctx.kv.set('settings:pocket.folder.' + 名, 柄);
    return { 连上: 名 };
  },
  柄: async 名 => ctx.kv.get('settings:pocket.folder.' + 名),
};
// ══════════ 装配 ══════════
if (ctx.root) {
  // 口袋窗挂不上不耽误能力(data.* 照常)
  try {
    const 位 = document.createElement('div');
    位.style.cssText = 'height:100%';
    ctx.root.appendChild(位);
    口袋.挂(位).then(off => off && ctx.cleanup(off)).catch(e => ctx.log('口袋窗没挂上:', e.message));
  } catch (e) { ctx.log('口袋窗没挂上(能力照常用):', e.message); }
}
(async () => { await 归属.载(); })();
return {};
