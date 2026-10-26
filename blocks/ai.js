// @nodule {"id":"ai","name":"AI 配置","icon":"🧠","version":1,"caps":["ai"]}
'use strict';
// ↦ 借 hypha 的 离体运行时
// ══════════ 自报 ══════════
// 一处配好厂商和模型: 各块和孢子的对话、出图、语音都经这里调, Key 不出本块
// 数据 {"prefix": "settings:ai.", "label": "厂商与模型", "kind": "config", "edit": "ai.configure"}
// 现在 ai.providers
// ══════════ 技能 ══════════
// 只写猜不到的事实, 只有注释、不跑
// 【接厂商】用户给了 API Key、要接新厂商或本地模型时: 绝大多数厂商和中转站都是 OpenAI 兼容,
//   用 ai.configure {name, endpoint, apiKey} 接, protocol 不用给。本地模型: endpoint 填
//   http://127.0.0.1:11434/v1(Ollama)/ 1234(LM Studio)/ 8000(vLLM), apiKey 留空;
//   浏览器报跨域就让用户给本地服务开跨域(Ollama: OLLAMA_ORIGINS=*)。
//   接完 ai.test 测, 通了会把 model 记成这一类用的模型。
// 【接口改法】某家的路径、字段和兼容协议不一样: 写改法, 是数据不改代码 ——
//   ai.configure {name, adapt: {类: {path, body}}}。body 并进默认请求体, 整格 "{参数名}" 换成调用给的值,
//   {model} 是选的模型, null 去掉默认字段。改完 ai.test 测。
// ══════════ 基础 ══════════
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 网络请求: 超时与重试的唯一入口, 免得每家各写一套。超时不重发(厂商可能已在算, 再发扣两次钱)
async function 网络请求(url, opt = {}) {
  const { retries = 1, timeout = 60000, signal: sg } = opt;
  let 真 = url, 经 = '', last;
  const 转 = opt.转发;
  if (转) [真, 经] = [(转.includes('{url}') ? 转 : 转 + '{url}').replace('{url}', encodeURIComponent(url)),
    `(经转发地址 ${转})`];
  for (let i = 0; i <= retries; i++) {
    if (i) await sleep(800);
    const ctrl = new AbortController(), onAbort = () => ctrl.abort(), timer = setTimeout(onAbort, timeout);
    if (sg) sg.aborted ? onAbort() : sg.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(真, Object.assign({}, opt, { signal: ctrl.signal }));
      clearTimeout(timer);
      if (res.status < 500 || i >= retries) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      clearTimeout(timer); last = e;
      if (sg?.aborted) throw e;
      if (ctrl.signal.aborted) break;
    }
  }
  if (last?.name === 'TypeError')
    throw Object.assign(new Error(`连不上 ${url}${经}: 网络不通, 或浏览器不让网页直接连它`), { retry: true });
  if (last?.name === 'AbortError') throw new Error(`请求 ${url} 超过 ${Math.round(timeout / 1000)} 秒没回应`);
  throw last;
}
// 并发闸: 每家同时在跑的请求有上限, 多的排队, 免得扇出几十个把额度打爆; 429 后 20 秒内降到 3
const 并发闸 = {
  桶: {},
  async 占(p) {
    const b = this.桶[p.id] = this.桶[p.id] || { 在跑: 0, 队: [], 降到: 0 };
    const 满 = Math.max(1, +p.concurrency || 8), 上限 = () => Date.now() < b.降到 ? Math.min(3, 满) : 满;
    while (b.在跑 >= 上限()) await new Promise(r => b.队.push(r));
    b.在跑++;
    return e => {
      b.在跑--;
      if (e && /\b429\b|rate.?limit|too many/i.test(e.message)) b.降到 = Date.now() + 20000;
      for (let n = 上限() - b.在跑; n > 0 && b.队.length; n--) b.队.shift()();
    };
  },
  async 跑(p, fn) {
    const 放 = await this.占(p);
    try { return await fn(); } catch (e) { throw e; } finally { 放(); }
  },
};
// ══════════ 协议适配 ══════════
// 协议表: 一种协议一行。绝大多数厂商走 openai-compatible; 形状完全不同的才加新协议。
// 类型表里每一行: 后缀(接在版本前缀后)、请求(a, model, p) → 发出去的 JSON、回复(res, p) → 统一形状。
const 协议 = {
  'openai-compatible': {
    对话请求: (a, p) => ({
      model: a.model || p.model,
      messages: a.messages,
      ...(a.tools?.length ? { tools: a.tools, tool_choice: 'auto' } : {}),
      ...(a.temperature !== undefined ? { temperature: a.temperature } : {}),
      ...(a.maxTokens ? { max_tokens: a.maxTokens } : {}),
      ...(a.stream ? { stream: true } : {}),
      ...(p.toolMode === 'text' ? { tools: undefined } : {}),
    }),
    解析回复: (j, p) => {
      const m = j.choices?.[0]?.message || {};
      return {
        content: m.content || '',
        toolCalls: (m.tool_calls || []).map(t => ({ id: t.id, name: t.function?.name,
          args: JSON.parse(t.function?.arguments || '{}') })) ,
        usage: j.usage ? { in: j.usage.prompt_tokens, out: j.usage.completion_tokens } : null,
      };
    },
    类型: {
      chat: { 后缀: '/chat/completions', 说明: '对话, 可带工具', 形状: {
        messages: { type: 'array', description: '[{role, content}]' },
        tools: { type: 'array', description: '[{name, description, parameters}]' },
        model: { type: 'string' }, provider: { type: 'string' }, stream: { type: 'boolean' },
        temperature: { type: 'number' }, maxTokens: { type: 'number' }, think: { type: 'string' } } },
      image: { 后缀: '/images/generations', 说明: '出图: 回 {url 或 b64, mimeType}', 形状: {
        prompt: { type: 'string' }, size: { type: 'string' }, n: { type: 'number' },
        model: { type: 'string' }, provider: { type: 'string' } } },
      tts: { 后缀: '/audio/speech', 说明: '语音合成: 回 {mimeType, data(base64)}', 形状: {
        text: { type: 'string' }, voice: { type: 'string' }, speed: { type: 'number' },
        model: { type: 'string' }, provider: { type: 'string' } } },
      embed: { 后缀: '/embeddings', 说明: '嵌入: 回 [{vector}]', 形状: {
        input: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string' } } },
    },
  },
};
// ══════════ 模型调用 ══════════
const 模型调用 = {
  基: p => (p.endpoint || '').replace(/\/+$/, ''),
  头: (p, json) => Object.assign({ 'Content-Type': 'application/json' },
    p.apiKey ? { Authorization: 'Bearer ' + p.apiKey } : {}),
  // 改法: adapt 是数据不改代码 —— body 并进默认请求体, "{参数名}" 换成调用给的值, null 去掉默认字段
  改体: (体, a, p, 类) => {
    const ad = p.adapt?.[类];
    if (!ad) return 体;
    const out = JSON.parse(JSON.stringify(体));
    Object.entries(ad.body || {}).forEach(([k, v]) => {
      if (v === null) delete out[k];
      else if (typeof v === 'string' && /^\{.+\}$/.test(v)) {
        const 名 = v.slice(1, -1);
        if (a[名] !== undefined) out[k] = a[名]; else if (v === '{model}') out[k] = 体.model;
      } else out[k] = v;
    });
    return out;
  },
  发: async (p, url, opt) => 并发闸.跑(p, () => 网络请求(url, Object.assign(
    { headers: 模型调用.头(p), timeout: 120000, retries: 1 }, opt, p.proxy ? { 转发: p.proxy } : {}))),
  错: async (res, p) => {
    let t = await res.text().catch(() => '');
    try { const j = JSON.parse(t); t = j.error?.message || j.message || t; } catch (e) { }
    throw new Error(`${p.name} 回 ${res.status}: ${String(t).slice(0, 300)}`);
  },
  chat: async (p, a) => {
    const 协 = 协议[p.protocol || 'openai-compatible'], 体 = 模型调用.改体(协.对话请求(a, p), a, p, 'chat');
    const res = await 模型调用.发(p, 模型调用.基(p) + 协.类型.chat.后缀,
      { method: 'POST', body: JSON.stringify(体) });
    if (!res.ok) await 模型调用.错(res, p);
    return 协.解析回复(await res.json(), p);
  },
  // 流式: 一行行 data: 解析, 文字逐片 {delta}, 思考 {reasoning}, 工具参数 {tool, chars}, 末片 {done}
  chatStream: async function* (p, a) {
    const 协 = 协议[p.protocol || 'openai-compatible'], 体 = 模型调用.改体(协.对话请求({ ...a, stream: true }, p), a, p, 'chat');
    const res = await 模型调用.发(p, 模型调用.基(p) + 协.类型.chat.后缀,
      { method: 'POST', body: JSON.stringify(体), timeout: 300000 });
    if (!res.ok) await 模型调用.错(res, p);
    const 读 = res.body.getReader(), 解 = new TextDecoder();
    let Buf = '', 全 = { content: '', reasoning: '', toolCalls: [] }, 工 = {};
    for (; ;) {
      const { done, value } = await 读.read();
      if (done) break;
      Buf += 解.decode(value, { stream: true });
      const 行s = Buf.split('\n'); Buf = 行s.pop();
      for (const 行 of 行s) {
        const m = /^data:\s*(.*)$/.exec(行.trim());
        if (!m) continue;
        if (m[1] === '[DONE]') continue;
        let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
        const d = j.choices?.[0]?.delta || {};
        if (d.content) { 全.content += d.content; yield { delta: d.content }; }
        if (d.reasoning_content || d.reasoning) { const r = d.reasoning_content || d.reasoning; 全.reasoning += r; yield { reasoning: r }; }
        for (const t of d.tool_calls || []) {          // yield 只能在生成器里: 不能用 forEach 包
          const i = t.index ?? 0;
          工[i] = 工[i] || { id: '', name: '', args: '' };
          if (t.id) 工[i].id = t.id;
          if (t.function?.name) 工[i].name += t.function.name;
          if (t.function?.arguments) { 工[i].args += t.function.arguments; yield { tool: 工[i].name, chars: t.function.arguments }; }
        }
      }
    }
    全.toolCalls = Object.values(工).map(t => ({ id: t.id, name: t.name, args: JSON.parse(t.args || '{}') }));
    yield { done: true, ...全, usage: null };
  },
};
// ══════════ 厂商配置 ══════════
const 键 = 'settings:ai.providers';
const 厂商配置 = {
  async 列表() { return (await ctx.kv.get(键)) || []; },
  async 找(name) { return (await 厂商配置.列表()).find(p => p.name === name) || null; },
  async 要(id) { return (await 厂商配置.列表()).find(p => p.id === id) || fail(`没有这个厂商: ${id}`); },
  async 新增(p) {
    const 表 = await 厂商配置.列表();
    表.push(Object.assign({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      protocol: 'openai-compatible', concurrency: 8 }, p));
    await ctx.kv.set(键, 表);
    return 厂商配置.要(表[表.length - 1].id);
  },
  async 更新(id, patch) {
    const 表 = await 厂商配置.列表(), p = 表.find(x => x.id === id) || fail(`没有这个厂商: ${id}`);
    Object.assign(p, patch);
    await ctx.kv.set(键, 表);
    return p;
  },
  async 删除(id) {
    await ctx.kv.set(键, (await 厂商配置.列表()).filter(p => p.id !== id));
    return { removed: id };
  },
  async 设默认(id) { await ctx.kv.set('settings:ai.default', id); return { default: id }; },
  默认id: async () => (await ctx.kv.get('settings:ai.default')) || null,
  // 选一家: 给了 id/name 用它; 否则这一类(modelOf)选过模型的、默认的, 按顺序找
  async 选(a, 类 = 'chat') {
    const 表 = await 厂商配置.列表();
    if (!表.length) fail('还没配厂商: 用 ai.configure {name, endpoint, apiKey} 接一个');
    let p = a?.provider ? 表.find(x => x.id === a.provider || x.name === a.provider) : null;
    if (!p && a?.provider) fail(`没有这个厂商: ${a.provider}(现有: ${表.map(x => x.name).join(', ')})`);
    if (!p) {
      const did = await 厂商配置.默认id();
      p = 表.find(x => 类 !== 'chat' && x.modelOf?.[类]) || 表.find(x => x.id === did)
        || 表.find(x => x.model) || 表[0];
    }
    if (!p.endpoint) fail(`${p.name} 没填 endpoint`);
    return p;
  },
  async 拉模型(p) {
    try {
      const res = await 模型调用.发(p, 模型调用.基(p) + '/models', { timeout: 20000, retries: 0 });
      if (!res.ok) return p;
      const j = await res.json();
      const ms = (j.data || []).map(m => m.id).sort();
      return 厂商配置.更新(p.id, { models: ms });
    } catch (e) { return p; }
  },
  文本: p => p.models || [],
};
// ══════════ 测通 ══════════
// 一次最小的真调用; 通了把这一类用的模型记下来(passed)
async function 测通(provider, type = 'chat', model) {
  const p = await 厂商配置.选({ provider });
  const t0 = Date.now();
  let r;
  if (type === 'chat') r = await 模型调用.chat(p, { messages: [{ role: 'user', content: '说"通"一个字' }], model, maxTokens: 8 });
  else if (type === 'image') r = await 模型调用.发(p, 模型调用.基(p) + '/images/generations',
    { method: 'POST', body: JSON.stringify({ model: model || p.modelOf?.image || 'test', prompt: 'a dot', n: 1 }) })
    .then(async res => res.ok ? { ok: true } : 模型调用.错(res, p));
  else if (type === 'embed') r = await 模型调用.发(p, 模型调用.基(p) + '/embeddings',
    { method: 'POST', body: JSON.stringify({ model: model || p.modelOf?.embed || 'test', input: 'hi' }) })
    .then(async res => res.ok ? { ok: true } : 模型调用.错(res, p));
  else fail(`这一类还不会测: ${type}(可先 ai.configure 记下模型, 真用时报错再说)`);
  const 表 = await 厂商配置.列表(), x = 表.find(y => y.id === p.id);
  x.passed = x.passed || {};
  x.passed[type] = { model: model || x.model || x.modelOf?.[type], at: Date.now(), ms: Date.now() - t0 };
  await ctx.kv.set(键, 表);
  return { ok: true, provider: p.name, type, model: x.passed[type].model, ms: x.passed[type].ms };
}
// ══════════ 选模型 ══════════
// 小表: 给某一类选哪家的哪个模型。别的块(桌面)借这一段, 界面一致。
// 自带转义(逃)和自己的取数: 整段自包含, 剪出去不依赖本块别的段
const 逃 = s => String(s ?? '').replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
const 选模型 = {
  esc: 逃,
  async 挂(el, { 类 = ['chat'], 题 = '选模型' } = {}) {
    const 表 = await ctx.call('ai.providers');
    const did = (await ctx.call('ai.providers')).find(p => p.default)?.id;
    el.innerHTML = `<div class="pick-m"><b>${逃(题)}</b>` + 表.map(p => {
      const 选 = 类.map(c => [c, p.modelOf?.[c] || (c === 'chat' ? p.model : '')]);
      return `<div class="pick-p" data-id="${逃(p.id)}"><span class="nm">${逃(p.name)}</span>`
        + (p.default ? '<span class="d">默认</span>' : '')
        + 选.map(([c, m]) => `<label>${逃(c)}<input data-f="${逃(p.id)}:${逃(c)}" value="${逃(m || '')}"
          placeholder="${逃(p.passed?.[c]?.model || '模型名')}"></label>`).join('') + '</div>';
    }).join('') + `<div class="pick-a"><button data-a="save">存</button>
      <button data-a="def">设为默认厂商</button></div></div>`;
    el.querySelector('[data-a="save"]').onclick = async () => {
      const 表2 = await ctx.call('ai.providers');
      const 改 = {};
      el.querySelectorAll('input[data-f]').forEach(i => {
        const [id, 类] = i.dataset.f.split(':');
        (改[id] = 改[id] || {})[类] = i.value.trim();
      });
      for (const [id, modelOf] of Object.entries(改)) {
        const p = 表2.find(x => x.id === id);
        if (p) await ctx.call('ai.configure', { name: p.name, modelOf });
      }
      el.dispatchEvent(new CustomEvent('pick:saved', { bubbles: true }));
    };
    el.querySelector('[data-a="def"]').onclick = async () => {
      const 卡 = el.querySelector('.pick-p:last-child');
      const 表 = await ctx.call('ai.providers'), p = 表.find(x => x.id === 卡.dataset.id);
      if (p) await ctx.call('ai.configure', { name: p.name, default: true });
      el.dispatchEvent(new CustomEvent('pick:saved', { bubbles: true }));
    };
    return () => { el.innerHTML = ''; };
  },
};
// ══════════ 装配 ══════════
// 能力都带形状(参数契约); 改配置的不接隔离窗, 调模型的孢子也能用(Key 不出本块)
const 配置形状 = { name: { type: 'string', description: '厂商显示名(同名=更新)' },
  endpoint: { type: 'string', description: '只填到版本前缀, 如 https://api.xxx.com/v1' },
  apiKey: { type: 'string', description: '本地模型留空' }, protocol: { type: 'string' },
  model: { type: 'string', description: '对话用的模型' }, default: { type: 'boolean' },
  concurrency: { type: 'number', description: '同时在跑的请求上限, 默认 8' },
  modelOf: { type: 'object', description: '{类型: 模型}, null 清掉' },
  notes: { type: 'object', description: '{模型: 一句标注}' }, toolMode: { type: 'string' },
  adapt: { type: 'object', description: '各类和兼容协议不一样的地方, 见「技能」段' },
  proxy: { type: 'string', description: '转发地址: 浏览器不让直连这家时全经它转, {url} 换原网址' },
  additionalProperties: false };
ctx.provide('ai.configure', async a => {
  if (!a.name) throw new Error('缺 name(厂商显示名; 同名=更新, 新名=新增)');
  const patch = {};
  Object.keys(配置形状).forEach(k => { if (a[k] !== undefined && k !== 'name') patch[k] = a[k]; });
  const old = await 厂商配置.找(a.name);
  let p = old ? await 厂商配置.更新(old.id, patch) : await 厂商配置.新增(Object.assign({ name: a.name }, patch));
  if (a.default) await 厂商配置.设默认(p.id);
  let pulled = '';
  if (!old || patch.apiKey || patch.endpoint || patch.protocol) {
    try { p = await 厂商配置.拉模型(p); pulled = `, 拉到 ${p.models.length} 个模型`; }
    catch (e) { pulled = ', 模型清单拉取失败: ' + String(e.message).slice(0, 80); }
  }
  return Object.assign(await 摘要(p), { pulled });
}, { desc: '新增或更新厂商(同名即更新), 顺带拉模型清单', schema: 配置形状, frames: false });
const 摘要 = async p => {
  const did = await 厂商配置.默认id();
  return { id: p.id, name: p.name, endpoint: p.endpoint, protocol: p.protocol,
    default: p.id === did, model: p.model, modelOf: p.modelOf || {}, passed: p.passed || {},
    notes: p.notes || {}, models: (p.models || []).length, concurrency: p.concurrency };
};
ctx.provide('ai.providers', async () => Promise.all((await 厂商配置.列表()).map(摘要)),
  { desc: '已配厂商(不含 Key): 每类选的模型、测通记录、标注', schema: {} });
ctx.provide('ai.models', async a => {
  const 类 = a.type || 'chat', out = [];
  for (const p of await 厂商配置.列表()) {
    const ms = 厂商配置.文本(p);
    if (类 === 'chat' && !ms.length && !a.all) continue;
    (ms.length ? ms : ['']).forEach(m => out.push({ model: m, provider: p.name, providerId: p.id,
      type: 类, tested: !!(p.passed?.[类] && (!m || p.passed[类].model === m)),
      default: false, note: p.notes?.[m] }));
  }
  const did = await 厂商配置.默认id(), d = out.find(x => x.providerId === did);
  if (d) d.default = true;
  return out;
}, { desc: '模型清单, 带标注(note)和测没测通(tested); all: 文本也列没拉到清单的', schema: { type: { type: 'string' }, all: { type: 'boolean' } } });
ctx.provide('ai.chat', async a => {
  if (!Array.isArray(a.messages)?.length) throw new Error('要 messages 数组: [{role, content}]');
  const p = await 厂商配置.选(a);
  return a.stream ? 模型调用.chatStream(p, a) : 模型调用.chat(p, a);
}, { desc: '对话, 可带工具: 回 {content, toolCalls, usage}; stream: true 回异步迭代器', schema: {
  messages: { type: 'array', description: '[{role, content}]' }, tools: { type: 'array' },
  model: { type: 'string' }, provider: { type: 'string' }, stream: { type: 'boolean' },
  temperature: { type: 'number' }, maxTokens: { type: 'number' }, think: { type: 'string' } } });
ctx.provide('ai.test', a => 测通(a.provider, a.type, a.model),
  { desc: '测试一类模型: 做一次最小的真调用, 通了记下来', schema: {
    provider: { type: 'string' }, type: { type: 'string' }, model: { type: 'string' } }, frames: false });
ctx.provide('ai.remove', async a => 厂商配置.删除((await 厂商配置.选({ provider: a.provider })).id),
  { desc: '删除厂商', schema: { provider: { type: 'string' } }, frames: false });
ctx.provide('ai.fetch', async a => {
  const p = await 厂商配置.要(a.provider);
  if (!/^\//.test(a.path)) throw new Error('path 要以 / 开头(接在版本前缀后面)');
  const res = await 模型调用.发(p, 模型调用.基(p) + a.path, Object.assign(
    { timeout: 180000, retries: 0 }, a.body !== undefined ? { method: 'POST', body: JSON.stringify(a.body) } : {}));
  if (!res.ok) await 模型调用.错(res, p);
  const ct = (res.headers.get('content-type') || '').split(';')[0];
  return /json/.test(ct) ? res.json() : /^text\//.test(ct) ? { text: await res.text() }
    : { mimeType: ct || 'application/octet-stream', data: btoa(String.fromCharCode(...new Uint8Array(await res.arrayBuffer()))) };
}, { desc: '类型表里没有的接口: 给 body 就 POST JSON, 不给 GET', schema: {
  provider: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' } }, frames: false });
// 设置卡片: 桌面块的设置窗把它请进去(ctx.root 在桌面块给的宿主里)
const 卡片 = {
  样式: `.ai-card{font-size:13px}.ai-card h3{margin:0 0 10px;font-size:14px}
.ai-card .row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}
.ai-card input,.ai-card select{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  color:#e8ecf0;border-radius:6px;padding:5px 8px;font-size:12px}
.ai-card input[data-f=endpoint]{width:260px}.ai-card input[data-f=apiKey]{width:180px}
.ai-card button{background:rgba(126,231,135,.1);border:1px solid rgba(126,231,135,.35);color:#7ee787;
  border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer}
.ai-card .p{display:flex;gap:8px;align-items:center;padding:7px 10px;border:1px solid rgba(255,255,255,.08);
  border-radius:8px;margin:6px 0}.ai-card .p .nm{font-weight:600}.ai-card .p .sp{flex:1}
.ai-card .muted{color:#8a8a8a;font-size:11px}
.ai-card .tag{font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(126,231,135,.12);color:#7ee787}`,
  async 挂(host) {
    host.innerHTML = `<style>${卡片.样式}</style><div class="ai-card">
<h3>🧠 厂商与模型</h3>
<div class="row"><input data-f="name" placeholder="名字(同名=更新)">
<input data-f="endpoint" placeholder="https://api.xxx.com/v1">
<input data-f="apiKey" type="password" placeholder="API Key(本地留空)">
<input data-f="model" placeholder="对话模型名" style="width:150px">
<button data-a="add">接上</button></div>
<div class="muted">本地模型: endpoint 填 http://127.0.0.1:11434/v1(Ollama), Key 留空。跨域就 OLLAMA_ORIGINS=*</div>
<div class="list"></div></div>`;
    const 列 = async () => {
      const ps = await ctx.call('ai.providers');
      host.querySelector('.list').innerHTML = ps.length ? ps.map(p => `<div class="p" data-id="${esc(p.id)}">
<span class="nm">${esc(p.name)}</span>${p.default ? '<span class="tag">默认</span>' : ''}
<span class="muted">${esc(p.endpoint || '')}</span>
<span class="muted">${esc(p.model || '(没选模型)')}</span>
${p.passed?.chat ? '<span class="tag">测通</span>' : ''}
<span class="sp"></span>
<button data-a="test">测通</button><button data-a="pick">选模型</button>
<button data-a="del">删</button></div>`).join('') : '<div class="muted">还没接厂商</div>';
    };
    host.addEventListener('click', async e => {
      const 钮 = e.target.closest('button'); if (!钮) return;
      const 卡 = 钮.closest('.p'), a = 钮.dataset.a;
      try {
        if (a === 'add') {
          const 取 = f => host.querySelector(`[data-f=${f}]`).value.trim();
          await ctx.call('ai.configure', { name: 取('name'), endpoint: 取('endpoint'),
            apiKey: 取('apiKey'), model: 取('model') });
          await 列();
        }
        if (a === 'test' && 卡) await ctx.call('ai.test', { provider: 卡.dataset.id });
        if (a === 'del' && 卡) await ctx.call('ai.remove', { provider: 卡.dataset.id });
        if (a === 'pick' && 卡) {
          const 位 = document.createElement('div');
          卡.after(位);
          await 选模型.挂(位, { 题: 卡.querySelector('.nm').textContent });
        }
      } catch (err) { alert(err.message); }
    });
    await 列();
    ctx.on('mycelium:blocks', 列);
    return () => { host.innerHTML = ''; };
  },
};
if (ctx.root) {
  // 设置卡挂不上不耽误能力(ai.* 照常); 异步挂载的拒绝要接住, 别变成未处理的 Promise
  try {
    const 位 = document.createElement('div');
    ctx.root.appendChild(位);
    Promise.resolve(卡片.挂(位))
      .then(off => off && ctx.cleanup(off))
      .catch(e => ctx.log('设置卡没挂上(能力照常用):', e.message));
  } catch (e) { ctx.log('设置卡没挂上(能力照常用):', e.message); }
}
return {};
