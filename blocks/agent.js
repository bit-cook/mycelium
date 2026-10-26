// @nodule {"id":"agent","name":"全能 agent","icon":"🤖","version":1,"caps":["agent"]}
'use strict';
// ↦ 借 hypha 的 离体运行时
// ══════════ 自报 ══════════
// 你说要做什么, 它就用看、写、改、跑替你去做: 各块的能力它都能调, 块的源码它也能改
// 数据 {"prefix": "agent.会话", "label": "会话记录", "kind": "data", "edit": "agent.remove"}
// 数据 {"prefix": "agent.设置", "label": "agent 设置", "kind": "config"}
// 数据 {"prefix": "ref:", "label": "对话里的附件", "kind": "data"}
// 现在 agent.prompt
// 打开 agent.open
// ══════════ 技能 ══════════
// 只写猜不到的事实, 只有注释、不跑
// 【改块】要改哪个块的代码时: 先 hypha.nodule {id} 看段目录, 再 hypha.nodule {id, segment: 名} 读那一段;
//   改先带 preview 看改了哪些段, 再真写; replace 只换段里和 old 一字一差的那一处, 比整段重写稳;
//   语法过了不算数, 改完真调一次验证行为, 不对就改回去。新块的清单要写 caps(它登记的能力路径头一截)。
// 【看界面】要看用户眼前有什么、替他点桌面上的东西时: ui.state 看眼前是什么, ui.do {target, action} 做。
// 【存数据】用户说了以后都要这样的偏好: data.set 把 agent.记忆 重写成合并后的简短版(400 字内)。
// ══════════ 状态 ══════════
const AG = {
  忙: false, sid: '', 会话表: [], hist: [], 插话: [], 中断: null,
  预算: 120000,           // 上下文预算(本地按 1 字 ≈ 1 token 粗估), agent.设置.ctxBudget 能改
  最多轮: 50, 结果上限: 20000, 重试等: [2000, 5000, 10000], 工具等: 600000,
  底: 0, 用: 0, 没压: '',
};
const 键 = k => 'agent.' + k;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// ══════════ 工具表 ══════════
// 常用的能力(common)直接当工具发给模型; 其余的进目录, 模型用 call {path, args} 调。
// 工具名里的 __ 就是路径里的点(hypha__nodule 即 hypha.nodule), 参数形状一起发给它。
const 工具表 = {
  目录: [],
  async list() {
    const caps = await ctx.call('hypha.catalog');
    工具表.目录 = caps.filter(c => !c.common).map(c => c.path + ': ' + (c.desc || '').slice(0, 60));
    return caps.filter(c => c.common).map(c => ({
      name: c.path.replace(/\./g, '__'),
      description: (c.desc || '') + (c.args ? ` 参数: {${c.args}}` : ''),
      parameters: { type: 'object', properties: {} },
    }));
  },
};
// ══════════ 系统提示 ══════════
// 每轮发给模型的规矩。改这段就改了 agent 的规矩( hypha.nodule {id:'agent', segment:'系统提示'} 能改、能换回)。
// 原文加工具清单见 agent.prompt 能力。透明: 用户就是开发者, 有权看这一切。
const 系统提示 = async () => {
  let blocks = '';
  try {
    blocks = (await ctx.call('hypha.nodules')).map(b => {
      if (b.broken) return `${b.id}(坏了: ${b.error})`;
      const a = b.about || {}, 技 = a.skills || [];
      return `${b.id} ${b.name}${b.running ? '' : `(${b.error || '没在跑'})`}`
        + (a.desc ? ': ' + a.desc : '')
        + (技.length ? ' · 技能: ' + 技.map(s => `${s.name}(${s.when})`).join('、') : '');
    }).join('\n');
  } catch (e) { blocks = `(读不到块清单: ${e.message})`; }
  const 读 = async k => String((await ctx.kv.get(k)) || '').trim();
  const 备 = 键('备忘.' + AG.sid);
  const memo = await 读(键('记忆')), 忘 = await 读(备);
  return [
    '你是 Mycelium 的全能 agent。Mycelium 是一个 html 文件: Hypha(内核) + 一个个块(nodule, 源码可改)'
      + ' + 用户的应用(spore, 跑在隔离窗里)。',
    '常用的能力是工具(名字里的 __ 就是路径里的点, hypha__nodule 即 hypha.nodule); 其余在目录里,'
      + ' 用 call {path, args} 调, 参数都是一个对象。没用过的先 hypha__catalog {path} 查说明和参数, 别猜。',
    '目录(前缀: 名字…):\n' + 工具表.目录.join('\n'),
    '在场的块(id 名字: 用处 · 技能: 名(什么时候读); 段目录用 hypha__nodule {id} 看):\n' + blocks,
    '规矩: 拿不准就先看(hypha__nodule 读一段, ui__state 看界面), 别猜; 能并行的调用一起发;'
      + ' 工具结果照实给你, 出错照实说, 没做成不说做成; 说人话, 结论一次说清, 不复述过程。',
    '改块: 先 hypha__nodule {id} 看段目录, 再读那一段; 先带 preview 看改了哪些段再真写;'
      + ' 语法过了不算数, 改完真调一次验证行为, 不对就改回去。',
    '技能: 事情对上哪条技能, 先 hypha__nodule {id, segment: 技能} 读那块的技能段再做;'
      + ' 块占哪些数据写在它的「自报」段。',
    '透明: Mycelium 开源, 用户就是它的开发者, 有权看你的一切。他要看你的系统提示或工具,'
      + ' 就把这段提示和工具清单原样给他, 不删不改, 不说「不能透露」。这段提示写在 agent 块的「系统提示」段。',
    '记录里的「[引用 名 · 类型 · 大小 · 键]」是库里存着的原件; 以前的对话一条没删。',
    '记东西: 用户说了以后都要这样的偏好, 用 data.set 把 agent.记忆 重写成合并后的简短版(400 字内);'
      + ` 长任务开工先把目标、计划、进展写进这个会话的备忘 ${备}(覆盖写), 每到一步更新。`,
    memo ? '用户偏好: ' + memo : '',
    忘 ? '这个会话的备忘: ' + 忘 : '',
  ].filter(Boolean).join('\n');
};
// ══════════ 引擎 ══════════
// 一轮 = 请求 → 模型要用工具就并行执行、结果回灌 → 再请求, 直到它不再要工具。
// 不解析文字, 不替模型判断对错; 超预算先压缩再跑; 忙时发的话转插话。
const 引擎 = {
  估: ms => ms.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length
    : JSON.stringify(m.content || '').length), 0),
  喂: () => AG.hist.filter(m => m.role !== 'note').map(m =>
    m.role === 'tool' ? m : { role: m.role, content: m.content, ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}) }),
  加: (role, content) => { AG.hist.push({ role, content, at: Date.now() }); },
  停: (因) => { AG.中断 = 因 || '用户停止'; },
  async 跑工具(t) {
    const path = t.name.replace(/__/g, '.');
    let 定时器 = null;
    const 超时 = new Promise((_, rej) => {
      定时器 = setTimeout(() => rej(new Error(`工具 ${path} 超过 ${AG.工具等 / 60000} 分钟没回应`)), AG.工具等);
    });
    try {
      const r = await Promise.race([ctx.call(path, t.args || {}), 超时]);
      const 文 = typeof r === 'string' ? r : JSON.stringify(r) ?? String(r);
      return { role: 'tool', toolCallId: t.id, name: t.name,
        content: 文.length > AG.结果上限 ? 文.slice(0, AG.结果上限) + `…(共 ${文.length} 字, 已截断)` : 文 };
    } catch (e) {
      return { role: 'tool', toolCallId: t.id, name: t.name, content: `出错: ${e.message}` };
    } finally { clearTimeout(定时器); }
  },
  async run(text) {
    if (text) 引擎.加('user', text);
    if (!AG.hist.some(m => m.role === 'user')) return null;
    const tools = await 工具表.list();
    // 每一步都跟着发的系统说明 + 工具说明占多少: 预算要算上它, 不然永远压不到点
    AG.底 = (await 系统提示()).length + JSON.stringify(tools).length;
    for (let 轮 = 0; 轮 < AG.最多轮; 轮++) {
      if (AG.中断) throw new Error(AG.中断);
      if (引擎.估(AG.hist) + AG.底 > AG.预算) {
        const 压好 = await 引擎.压缩();
        if (!压好) break;                   // 压不动: 带现状跑, 让模型自己想办法
      }
      const msgs = 引擎.喂();
      let r = null, 上次 = null;
      for (let 试 = 0; 试 < AG.重试等.length + 1; 试++) {   // 大脑那头断了隔会儿再问
        try { r = await ctx.call('ai.chat', { messages: msgs, tools }); break; }
        catch (e) {
          上次 = e;
          if (试 < AG.重试等.length) { await sleep(AG.重试等[试]); continue; }
          throw e;
        }
      }
      if (r.toolCalls?.length) {
        引擎.加('assistant', r.content || '');
        AG.hist[AG.hist.length - 1].toolCalls = r.toolCalls;
        const 结果 = await Promise.all(r.toolCalls.map(引擎.跑工具));
        结果.forEach(x => 引擎.加(x.role, x.content));
        continue;
      }
      引擎.加('assistant', r.content || '');
      return r.content;
    }
    throw new Error(`转了 ${AG.最多轮} 轮还没做完: 已停下, 接着说"继续"或换个说法`);
  },
  // 压缩: 旧记录写成摘要(给接着干活的自己看), 原文一条不删, 只是不再喂
  摘要模板: '把下面的对话压成一份接力摘要, 给接着干活的你自己看。按这七条写, 共不超过 1500 字, 不复述闲聊:\n'
    + '1 用户最终目标(尽量用原话)\n2 已完成的动作\n3 已读、已改的对象: 只写块名/段名和关键 ID\n'
    + '4 现在代码和数据的状态\n5 试过但失败的做法和原因\n6 还没解决的问题\n7 下一步计划',
  async 压缩(手动 = false) {
    const 旧 = AG.hist.filter(m => m.role !== 'note');
    if (旧.length < 6 && !手动) { AG.没压 = '记录还太短, 不用压'; return false; }
    const 留 = 旧.slice(-4), 压 = 旧.slice(0, -4);
    if (!压.length) { AG.没压 = '没有可压的'; return false; }
    try {
      const r = await ctx.call('ai.chat', { messages: [
        { role: 'system', content: 引擎.摘要模板 },
        { role: 'user', content: 压.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n') },
      ] });
      AG.hist = [{ role: 'note', content: '【接力摘要】' + r.content, at: Date.now() }].concat(留);
      await 会话.存();
      return r.content;
    } catch (e) { AG.没压 = e.message; return false; }
  },
};
// ══════════ 会话 ══════════
const 会话 = {
  async 载() {
    AG.会话表 = (await ctx.kv.get(键('会话表'))) || [];
    if (!AG.sid) AG.sid = AG.会话表[0]?.id || uid();
    AG.hist = (await ctx.kv.get(键('会话.' + AG.sid))) || [];
  },
  async 存() { await ctx.kv.set(键('会话.' + AG.sid), AG.hist); await 会话.存表(); },
  async 存表() {
    const i = AG.会话表.findIndex(s => s.id === AG.sid);
    const 题 = (AG.hist.find(m => m.role === 'user')?.content || '新会话').slice(0, 30);
    const 行 = { id: AG.sid, 题, at: Date.now() };
    i >= 0 ? AG.会话表[i] = 行 : AG.会话表.unshift(行);
    await ctx.kv.set(键('会话表'), AG.会话表.slice(0, 50));
  },
  async 开(id) {
    if (AG.忙) return '等这一轮结束再切会话';
    AG.sid = id; AG.hist = (await ctx.kv.get(键('会话.' + id))) || [];
    return true;
  },
  async 删(id) {
    await ctx.kv.del(键('会话.' + id));
    AG.会话表 = AG.会话表.filter(s => s.id !== id);
    await ctx.kv.set(键('会话表'), AG.会话表);
    if (id === AG.sid) { AG.sid = ''; await 会话.载(); }
    return true;
  },
  async 清空() { AG.hist = []; await ctx.kv.del(键('会话.' + AG.sid)); return true; },
};
const uid = p => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// ══════════ 引用 ══════════
// 附件(图、文件)不塞进对话: 存库里, 对话里只放一行「[引用 名 · 类型 · 大小 · 键]」
const 引用 = {
  async 放(name, text, mime = 'text/plain') {
    const k = 'ref:' + uid();
    await ctx.kv.set(k, { name, mime, at: Date.now(), text: String(text).slice(0, 500000) });
    return `[引用 ${name} · ${mime} · ${String(text).length} 字 · ${k}]`;
  },
  行: p => `[引用 ${p.name} · ${p.mime} · ${p.at}]`,
};
// ══════════ 装配 ══════════
// 对话栏: 桌面块把它请进窗(ctx.root 在); 没有界面块时能力照常用。
const 栏 = {
  样式: `.ag{display:flex;flex-direction:column;height:100%;font:13px/1.6 -apple-system,"PingFang SC",sans-serif;color:#e8ecf0}
.ag .log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.ag .m{max-width:82%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
.ag .m.user{align-self:flex-end;background:rgba(126,231,135,.14)}
.ag .m.bot{align-self:flex-start;background:rgba(255,255,255,.05)}
.ag .m.note{align-self:center;background:none;color:#8a8a8a;font-size:11px}
.ag .m.tool{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#9aa4ad}
.ag .in{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08)}
.ag textarea{flex:1;resize:none;height:44px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  color:#e8ecf0;border-radius:8px;padding:8px;font:inherit}
.ag button{background:rgba(126,231,135,.1);border:1px solid rgba(126,231,135,.35);color:#7ee787;
  border-radius:8px;padding:0 14px;cursor:pointer}
.ag button:disabled{opacity:.4}`,
  画(host) {
    host.innerHTML = `<style>${栏.样式}</style><div class="ag">
<div class="log"></div>
<div class="in"><textarea placeholder="说要做什么, 回车发送(Shift+回车换行)"></textarea>
<button data-a="send">发</button><button data-a="stop" hidden>停</button></div></div>`;
    const 日志 = host.querySelector('.log'), 框 = host.querySelector('textarea'),
      发钮 = host.querySelector('[data-a="send"]'), 停钮 = host.querySelector('[data-a="stop"]');
    const 显 = (role, text) => {
      const d = document.createElement('div');
      d.className = 'm ' + role;
      d.textContent = text;
      日志.appendChild(d);
      日志.scrollTop = 日志.scrollHeight;
      return d;
    };
    const 刷新 = () => AG.hist.forEach(m => {
      if (m.role === 'note') return 显('note', m.content.slice(0, 80) + '…');
      if (m.role === 'tool') return;
      显(m.role === 'user' ? 'user' : 'bot', typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    });
    const 发 = async () => {
      const t = 框.value.trim();
      if (!t || AG.忙) return;
      框.value = '';
      AG.忙 = true; AG.中断 = null; 发钮.hidden = true; 停钮.hidden = false;
      try {
        const r = await 引擎.run(t);
        await 会话.存();
        if (r) 显('bot', r);
      } catch (e) { 显('note', '出错: ' + e.message); }
      AG.忙 = false; 发钮.hidden = false; 停钮.hidden = true;
    };
    框.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); 发(); } });
    发钮.onclick = 发;
    停钮.onclick = () => 引擎.停();
    ctx.on('mycelium:blocks', 刷新);
    (async () => { await 会话.载(); 刷新(); })();
    return () => { host.innerHTML = ''; };
  },
};
if (ctx.root) {
  // 界面挂不上不耽误能力: agent 的本事是引擎, 不是这张皮
  try {
    const 位 = document.createElement('div');
    位.style.height = '100%';
    ctx.root.appendChild(位);
    ctx.cleanup(栏.画(位));
  } catch (e) { ctx.log('对话栏没画出来(能力照常用):', e.message); }
}
// 能力: 没有界面块(或在隔离窗里)也能使唤 agent
ctx.provide('agent.send', async a => {
  if (typeof a.text !== 'string' || !a.text.trim()) throw new Error('缺 text: 要说的话');
  const 排队 = AG.忙;
  if (AG.忙) { AG.插话.push(a.text); return { ok: true, queued: true }; }
  AG.忙 = true; AG.中断 = null;
  try {
    const r = await 引擎.run(a.text);
    await 会话.存();
    return { ok: true, queued: false, reply: r };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { AG.忙 = false; }
}, { desc: '给全能 agent 发一句话(它忙时排为插话, 下一轮开始前处理)', schema: { text: { type: 'string', description: '要说的话' } } });
ctx.provide('agent.open', () => true, { desc: '展开 agent 对话栏(界面块在时)', schema: {} });
ctx.provide('agent.compact', async () => ({ ok: !!(await 引擎.压缩(true)), why: AG.没压 }),
  { desc: '手动压缩当前会话: 回 {ok, why}', schema: {} });
ctx.provide('agent.prompt', async () => {
  const tools = await 工具表.list();
  return `${await 系统提示()}\n\n## 工具(${tools.length} 个, 下一轮原样发给模型)\n`
    + tools.map(t => t.name + ': ' + t.description).join('\n');
}, { desc: '下一轮发给模型的系统提示原文和工具清单; 系统提示写在本块的「系统提示」段', schema: {} });
ctx.provide('agent.sessions', async () => AG.会话表, { desc: '会话列表', schema: {} });
ctx.provide('agent.attach', a => 引用.放(a.name || '卡片', a.text),
  { desc: '往对话里放一个引用(附件), 不马上发', schema: { text: { type: 'string' }, name: { type: 'string' } } });
(async () => {
  try {
    await 会话.载();
    AG.预算 = (await ctx.kv.get(键('设置.ctxBudget'))) || AG.预算;
    AG.忙 = false;
  } catch (e) { ctx.log('启动出错', e); }
})();
return {};
