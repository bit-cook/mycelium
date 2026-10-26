/* ═══════════════════════════════════════════════════════════════════════════
   Hypha · Mycelium 的内核
   ─────────────────────────────────────────────────────────────────────────
   一个文件跑得起来的个人 AI 操作系统的最小内核。它自己也是"一块":
   段(section)/范围(scope)/借用(borrow)三件套让代码可被程序理解和局部修改;
   能力网(the Net)是块与块、块与 agent、块与小应用之间唯一的交互协议;
   改块是唯一写入口, 带回滚、预览、审批; 导出永远过门禁。

   设计原则(从 Colony 继承并加强):
   1. 零依赖: 不 import 任何库, 不构建即可跑; 多文件只是开发态, 发布仍是单文件
   2. 注释即接口: 段头/借用行/自报段都是人和 agent 都读得懂的协议
   3. 单一写入口: 一切状态变更经 setNodule / sub.set, 才能做日志、快照、回滚
   4. 对 agent 透明: agent 能读全部源码、改任何段、看自己的系统提示原文
   5. 坏一块不拖垮全部: 装载容错, 块坏了自己记错, 别人照跑
   6. 说人话: 每条错误都讲清"谁、为什么、怎么办"

   文件形态(发布态): 一个 mycelium.html, 双击即用。
     script#hypha          内核(本文件)
     script#hypha-launcher 启动器: 认血统、注入 env、调 boot
     script[type=mycelium/nodule]  块: NODULE 清单 + CODE 函数体, 一个块一个标签
   ═══════════════════════════════════════════════════════════════════════════ */
;(function (g) {
  'use strict';

  // ══════════ 基础 ══════════
  // env 由启动器(或测试)注入: 内核不直接摸全局, 所以在 node 里也能跑
  let E = null;                       // {doc, win, ls, idb, fetch, setTimeout, clearTimeout}
  const doc = () => E.doc, win = () => E.win, LS = () => E.ls;
  const norm = s => String(s ?? '').replace(/^\s*\n/, '').replace(/\s+$/, '');
  const fail = msg => { throw new Error(msg); };
  const SCR = 'scr' + 'ipt';
  const emit = (name, detail) => {
    const d = E?.doc;
    if (d) d.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  };
  const on = (name, fn) => {          // 文档级事件; 无文档(node 测试)时空转
    const d = E?.doc;
    if (!d) return () => { };
    const h = e => { try { fn(e.detail); } catch (err) { console.error('[on ' + name + ']', err); } };
    d.addEventListener(name, h);
    return () => d.removeEventListener(name, h);
  };
  const sleep = ms => new Promise(r => E.setTimeout(r, ms));
  const hash = s => {                 // 双 hash: 碰撞概率随长度指数下降, 做基线号/指纹
    s = String(s ?? '');
    let a = 5381, b = 2166136261;
    for (let i = 0, c; i < s.length; i++) {
      c = s.charCodeAt(i);
      a = ((a << 5) + a + c) >>> 0;
      b = Math.imul(b ^ c, 16777619) >>> 0;
    }
    return [a, b].map(n => n.toString(16).padStart(8, '0')).join('');
  };
  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  const isIdent = n => /^[\p{ID_Start}_$][\p{ID_Continue}_$]*$/u.test(String(n));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
  const now = () => Date.now();
  const uid = p => (p || '') + now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ══════════ 形状 ══════════
  // 能力参数用形状描述, 两种写法都认:
  //   简写(内核用): { name: 'string', full: 'boolean?', active: 'edited|factory?' }
  //               字符串 = 类型, 结尾 ? = 可选, 带 | = 枚举
  //   全写(块用):  { name: { type: 'string', description: '显示名' } }  —— JSON Schema 子集
  // 校验器 ~70 行, 内联进内核: 契约必须是内核的一部分, 不能靠外部库。
  // 三种写法都认(只在外层规范化一次, 递归里传过的都是已规范化的 Schema):
  //   内核简写  { id: 'string', full: 'boolean?' }          值 = '类型?' 字符串, ? 结尾可选, | 分隔枚举
  //   块平铺    { name: { type: 'string', description } }    值 = JSON Schema 片段
  //   标准式    { type: 'object', properties: {...} }        原样用
  const 正化 = s => {
    if (!s || typeof s !== 'object' || !Object.keys(s).length) return s;
    // 含任一 Schema 形状关键字的, 就是(或像)一个完整 Schema, 不当字段表
    // (additionalProperties / required / default 不算: 它们也可能是字段名)
    const 关键字 = ['type', 'properties', 'enum', 'items', 'description', 'minLength',
      'oneOf', 'anyOf', 'format'];
    if (Object.keys(s).some(k => 关键字.includes(k))) return s;
    const { additionalProperties, ...字段 } = s;
    const 值 = Object.values(字段);
    const 简写 = 值.length && 值.every(v => typeof v === 'string');
    const 平铺 = 值.length && 值.every(v => v && typeof v === 'object' && !Array.isArray(v));
    if (!简写 && !平铺) return s;                       // 认不出: 不校验, 不添乱
    const out = { type: 'object', properties: {} };
    if (additionalProperties !== undefined) out.additionalProperties = additionalProperties;
    const 原型 = ['string', 'number', 'boolean', 'object', 'array', 'null'];
    Object.entries(字段).forEach(([k, v]) => {
      if (typeof v === 'string') {
        const 净 = v.replace(/\s*\([^()]*\)\s*$/, '').trim();    // 剥掉尾部 (说明)
        const 问 = /\?$/.test(净), 干 = 净.replace(/\?$/, '').trim(), 些 = 干.split('|');
        const 阵 = /^([a-z]+)\[\]$/.exec(干);
        out.properties[k] = 阵 && 原型.includes(阵[1]) ? { type: 'array', items: { type: 阵[1] } }
          : 些.every(x => 原型.includes(x))
            ? { type: 些.length > 1 ? 些 : 些[0] }    // string|null = 类型联合
            : { enum: 些 };                          // edited|factory = 枚举
        if (!问) (out.required ||= []).push(k);
      } else out.properties[k] = v;
    });
    return out;
  };
  const checkShape = (v, s0, at = '') => {
    const s = 正化(s0);
    if (!s || typeof s !== 'object') return;
    const T = (Array.isArray(s.type) ? s.type : [s.type]).filter(Boolean), kind = v === null ? 'null'
      : Array.isArray(v) ? 'array' : typeof v;
    if (T.length && !T.includes(kind))
      fail(`${at || '参数'} 要是 ${T.join('|')}, 给了 ${kind}(${JSON.stringify(v).slice(0, 40)})`);
    if (s.enum && !s.enum.includes(v))
      fail(`${at} 只能是 ${s.enum.map(x => JSON.stringify(x)).join(' / ')}, 给了 ${JSON.stringify(v)}`);
    if (kind === 'object' && s.properties) {
      (s.required || []).forEach(k => {
        if (v[k] === undefined) fail(`${at} 缺 ${k}(${s.properties[k]?.description || ''})`);
      });
      if (s.additionalProperties === false)
        Object.keys(v).forEach(k => {
          if (!s.properties[k]) fail(`${at} 有不认识的字段 ${k}; 允许: ${Object.keys(s.properties).join(', ')}`);
        });
      Object.keys(s.properties).forEach(k => {
        if (v[k] !== undefined) checkShape(v[k], 正化(s.properties[k]), at ? at + '.' + k : k);
      });
    }
    if (kind === 'array' && s.items && Array.isArray(v))
      v.forEach((x, i) => checkShape(x, 正化(s.items), `${at}[${i}]`));
    if (kind === 'string' && s.minLength && v.length < s.minLength) fail(`${at} 至少 ${s.minLength} 个字`);
  };
  // 给人/agent 看的一句话参数表: "name(厂商显示名) endpoint?(只填到版本前缀)"
  const shapeLine = s => {
    const q = 正化(s);
    return !q?.properties ? '' : Object.entries(q.properties)
      .map(([k, p]) => k + ((q.required || []).includes(k) ? '' : '?') + (p.description ? `(${p.description})` : ''))
      .join(', ');
  };

  // ══════════ 段解析 ══════════
  // 块的代码结构协议(人和程序都读):
  //   // ═ 段名 · v2 ═                 段头: 管到下一段头; 一行代码必属于且只属于一段
  //   // ═ 段名 · 跟着: a, b ═         这段要用 a/b(范围或段): 剪段时连它们一起剪
  //   // ↦ 借 ai 的 协议适配           借用行: 整段是另一个块的段/范围, 经段值表懒取值
  //   // ✂ 范围名  ...  // ✂ 范围名 完   范围: 可跨段、嵌套、交叉
  //   // ✂ 离体时不带 · 号: n  ... 完   离体(孢子导出)时不留的代码, 导回按号找回
  // 段头元数据键(中文, 说人话):
  const KEY = { 跟着: 'follows', 源自: 'from', 要: 'want', 按需: 'ask', 带了: 'got',
    指纹: 'sum', 借用者: 'borrowers', 号: 'tag' };
  const MARK = /^\s*\/\/\s*(?:═+\s*(.+?)\s*═+|(↦|✂)\s*(.+?))\s*$/;
  const blank = name => ({ name, v: 0, follows: [], want: [], got: [], borrowers: [],
    from: null, map: null, sum: '', tag: '' });
  const mark = line => {
    const m = MARK.exec(line);
    if (!m) return null;
    const [n, ...f] = (m[1] || m[3]).split(/\s*·\s*/);
    const b = m[2] && (m[2] === '↦'
      ? /^借\s+(\S+)\s+的\s+(.+)$/.exec(n)
      : /^(.+?)(\s+完)?$/.exec(n));
    if (m[2] && !b) return null;       // 有 ↦/✂ 却不像借用行/范围行: 不是标记
    const s = blank(!b ? n : m[2] === '↦' ? b[2] : b[1]);
    if (m[2] === '↦') s.map = { block: b[1], name: b[2] };
    if (m[2] === '✂') Object.assign(s, { cut: true, end: !!b[2] });
    f.forEach(x => {
      const [, k, v] = /^(\S+?)\s*[:：]\s*(.*)$/.exec(x) || [], key = KEY[k];
      if (/^v\d+$/.test(x)) s.v = +x.slice(1);
      else if (key === 'from' && /^(\S+?)\/(.+?)(?:\s+v(\d+))?$/.test(v)) {
        const o = /^(\S+?)\/(.+?)(?:\s+v(\d+))?$/.exec(v);
        s.from = { block: o[1], name: o[2], v: +(o[3] || 0) };
      } else if (key) s[key] = /ask|sum|tag/.test(key) ? v.trim()
        : v.split(/\s*[,，]\s*/).filter(Boolean);
      else fail(`标记认不出: "${x}"(${s.name})。允许: v数字 / ${Object.keys(KEY).join(' / ')}`);
    });
    return s;
  };
  const parseSegs = code => {
    const out = { prologue: [], segs: [] };
    let cur = null;
    String(code).split('\n').forEach(line => {
      const h = mark(line);
      if (h && !h.cut) out.segs.push(cur = Object.assign(h, { lines: [line] }));
      else if (cur) cur.lines.push(line);
      else out.prologue.push(line);
    });
    out.segs.forEach(s => { s.text = s.lines.join('\n'); });
    return out;
  };
  const joinSegs = p => p.prologue.concat(...p.segs.map(s => s.lines)).join('\n');
  const headLine = s => (s.map ? '// ↦ 借 ' + s.map.block + ' 的 ' + s.map.name : '// ═ ' + s.name)
    + (s.v ? ' · v' + s.v : '') + Object.entries(KEY).map(([k, key]) => {
      const f = s.from, v = key === 'from' ? f && f.block + '/' + f.name + (f.v ? ' v' + f.v : '') : s[key];
      return v?.length ? ' · ' + k + ': ' + [].concat(v).join(', ') : '';
    }).join('') + (s.map ? '' : ' ═');
  const bodyOf = s => s.lines.slice(1).join('\n');
  const segKey = s => headLine(Object.assign({}, s, { borrowers: [] })) + '\n' + bodyOf(s);
  const checkSegs = (p, where) => {
    const seen = {};
    p.segs.forEach(s => {
      if (seen[s.name]) fail(`段名重复: ${where}/${s.name}`);
      seen[s.name] = 1;
    });
    return p;
  };
  // 排开: 每行属于哪段(-1 = 前言)、在哪些范围里、范围配对、范围要什么(need)
  const 离体 = '离体时不带';
  const lay = (p, where, 宽) => {
    const L = { p, where, lines: p.prologue.concat(...p.segs.map(s => s.lines)),
      seg: [], in: [], cut: [], pair: [], need: {}, 处: {} }, open = [];
    const 在 = () => open.find(o => o[0] === 离体)?.[1];
    const 坏 = m => { if (宽) L.坏 ||= m; else fail(m); };
    let n = -1;
    L.lines.forEach((l, i) => {
      const m = mark(l), at = `第 ${i + 1} 行: `;
      const k = m?.cut ? open.findLastIndex(o => o[0] === m.name) : -1;
      if (m && !m.cut && 在() >= 0) 坏(at + `「${离体}」不能圈段头`);
      L.seg.push(m && !m.cut ? ++n : n);
      L.in.push(new Set(open.map(o => o[0]).concat(m?.cut ? m.name : [])));
      if (!m?.cut) return;
      L.cut[i] = m.name;
      if (m.end) {
        if (k < 0) return 坏(at + `「${m.name} 完」前面没有开头`);
        const [, h, 头在] = open.splice(k, 1)[0];
        if (头在 !== 在()) 坏(at + `「${m.name}」和「${离体}」交叉: ${离体} 只能整个包住别的范围, 或一头都不碰`);
        return L.pair[L.pair[i] = h] = i;
      }
      if (k >= 0) 坏(at + `「${m.name}」没收尾又开了一个同名的`);
      if (m.name !== 离体) L.need[m.name] = (L.need[m.name] || []).concat(m.want);
      else if (!m.tag) 坏(at + `「${离体}」要起个名字: // ✂ ${离体} · 号: 名`);
      else if (m.tag in L.处) 坏(at + `「${离体}」的号「${m.tag}」重了`);
      else L.处[m.tag] = i;
      open.push([m.name, i, 在()]);
    });
    if (open.length) 坏(`范围「${open[0][0]}」没有收尾`);
    return L;
  };
  // 名单连一路「跟着」「要」到的 [范围名集合, 段号集合, 缺的名字]
  const 连 = (L, names) => {
    const R = new Set(), S = new Set(), 缺 = [], by = {};
    L.p.segs.forEach((s, i) => { by[s.name] = i; });
    const add = n => n in L.need ? (R.has(n) || (R.add(n), L.need[n].forEach(add)))
      : n in by ? (S.has(by[n]) || (S.add(by[n]), L.p.segs[by[n]].follows.forEach(add)))
        : 缺.push(n);
    names.forEach(add);
    return [R, S, 缺];
  };
  // 剪: 圈着的行, 圈它的范围有一个在名单上就留; 没圈的行和段头, 它那段在名单上就留;
  // 「离体时不带」圈的不留; 头尾只剩一个的标记行不留。names = null = 整份都要。
  const pick = (L, names, skip) => {
    const [R, S, 缺] = 连(L, names || []);
    if (缺.length) fail(`${L.where} 没有叫「${缺[0]}」的段或范围, 范围有: ${Object.keys(L.need).join(', ')}`);
    const k = L.lines.map((l, i) => !skip?.(i) && (L.in[i].has(离体)
      ? !names && L.cut[i] === 离体
      : !names || [...L.in[i]].some(r => R.has(r))
        || (!L.in[i].size || L.seg[i] !== L.seg[i - 1]) && S.has(L.seg[i])));
    return k.map((x, i) => x && !(L.cut[i] && !k[L.pair[i]]));
  };
  const 纹 = s => hash(norm(s)).slice(0, 8);
  const cutCode = (code, names, where, 号 = []) => {
    const L = lay(parseSegs(code), where), k = pick(L, names);
    k.forEach((x, i) => x && 号.push(i));
    return L.lines.filter((l, i) => k[i]).join('\n');
  };
  // 剪一份带走(借用方导出、源头不在场时用): 名字(点的+要+带了)合剪一份放第一行,
  // 后面几行各留一个空的复制段头, 导回时一行对一行。段头写源自/要/指纹。
  const 有 = p => new Set(p.segs.flatMap(s => {
    const o = s.map || s.from;
    return !o ? [] : [o.name].concat(s.from ? s.lines.map(l => (/^\/\/ ─ (.+) ─$/.exec(l) || [])[1]) : [])
      .filter(Boolean).map(n => o.block + '/' + n);
  }));
  const copyOf = (src, id, g, have, 号 = [], 不) => {
    const L = lay(src, id, 不), 错 = g.map(([s]) => s.got).find(x => x instanceof Error), out = [];
    g.forEach(([s]) => { s.got = 错 ? [] : s.got.filter(n => Object.hasOwn(L.need, n) || src.segs.some(x => x.name === n)); });
    const 名 = g.flatMap(([s, n]) => [n].concat(s.want, s.got)), 缺 = 连(L, 名)[2];
    const 别 = n => !名.includes(n) && have.has(id + '/' + n);
    const k = !L.坏 && !错 && !缺.length && pick(L, 名, i => 别(src.segs[L.seg[i]]?.name));
    const t = k && src.segs[L.seg[k.findIndex((x, i) => x && src.segs[L.seg[i]]?.map)]];
    const why = L.坏 || 错?.message || (缺.length ? 没名(L, 缺[0])
      : t && `它要用的「${t.name}」也是借来的, 请让借用方自己借 ${t.map.block}/${t.map.name}`);
    if (why && !不) fail(`带不走 ${id}/${g[0][1]}: ${why}`);
    if (why) { g.forEach(([s]) => { 不[s.map.block + '/' + s.map.name] = why; }); return null; }
    let last = null;
    k.forEach((x, i) => {
      const n = L.seg[i], s = src.segs[n] || { name: '(前言)' };
      if (!x) return;
      if (s !== last && s.name !== g[0][1]) out.push('// ─ ' + s.name + ' ─'), 号.push(L.seg.indexOf(n));
      last = s;
      if (n < 0 || n === L.seg[i - 1]) out.push(L.lines[i]), 号.push(i);
    });
    return g.map(([s], i) => {
      const body = i ? '' : out.join('\n');
      return headLine(Object.assign(blank(), s, { map: null, from: s.from || Object.assign({ v: s.v }, s.map),
        sum: 纹(body) })) + (i ? '' : '\n' + body);
    });
  };
  const 没名 = (L, n) => `${L.where} 没有叫「${n}」的段或范围, 范围有: ${Object.keys(L.need).join(', ')}`;
  const syntax = (code, what, args) => {
    try { new Function(...(args || []), code); }
    catch (e) { fail(`${what}有语法错误: ${e.message}`); }
  };
  // 块代码里重声明了块参(ctx/__seg/colony): 说清那是内核给的
  const 块参 = ['ctx', '__seg', 'colony'];
  const 重名 = e => /(?:Identifier '|redeclaration of (?:formal parameter |\S+ )?|twice: ')([^'\s]+)/
    .exec(e?.message)?.[1];
  const 块参错 = (e, n = 重名(e)) => 块参.includes(n) ? `块里不能再声明 ${n}(内核给每块自己的 ${n})` : '';

  // ══════════ 基质 ══════════
  // 存储的唯一实现: IndexedDB(打不开退内存) + 事件日志(journal) + 快照(snapshot)。
  // kv 是原始存取; 归属守卫在口袋块, 不在这里 —— 内核只管存, 不管谁该存。
  const memStore = () => {
    const m = new Map(), 拷 = x => x == null ? x : JSON.parse(JSON.stringify(x));
    return {
      get: async k => 拷(m.get(k)), set: async (k, v) => { m.set(k, 拷(v)); },
      del: async k => { m.delete(k); }, clear: async () => { m.clear() },
      list: async p => [...m].filter(([k]) => !p || String(k).startsWith(p))
        .map(([key, value]) => ({ key, value: 拷(value) })),
    };
  };
  const idbStore = name => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = E.idb.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const op = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('kv', mode), s = t.objectStore('kv'), q = fn(s);
      t.onerror = () => rej(t.error);
      if (q && 'onsuccess' in q) { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }
      else t.oncomplete = () => res(q);
    })), w = fn => op('readwrite', fn).then(() => { });
    return {
      get: k => op('readonly', s => s.get(k)), set: (k, v) => w(s => s.put(v, k)),
      del: k => w(s => s.delete(k)), clear: () => w(s => s.clear()),
      list: p => op('readonly', s => {
        const r = p ? IDBKeyRange.bound(p, p + '\uffff') : undefined;
        return { ks: s.getAllKeys(r), vs: s.getAll(r) };
      }).then(r => r.ks.result.map((k, i) => ({ key: k, value: r.vs.result[i] }))),
    };
  };
  const Sub = {
    store: null, mem: false, journalRing: [],
    async open(id) {
      this.store = E.idb ? idbStore(id) : memStore();
      this.mem = !E.idb;
      if (E.idb) {
        try { await this.store.get(''); }   // 隐私模式/系统关数据: 退内存, 能看不能存
        catch (e) { this.store = memStore(); this.mem = true; this.warn = e?.message || String(e); }
      }
      return this;
    },
    get: async k => (await Sub.store.get(k)) ?? null,
    async set(k, v, by) {
      await Sub.store.set(k, v);
      Sub.记({ op: 'set', key: k, by, size: v == null ? 0 : JSON.stringify(v).length });
    },
    async del(k, by) {
      await Sub.store.del(k);
      Sub.记({ op: 'del', key: k, by });
    },
    list: p => Sub.store.list(p),
    记(e) {                                   // 事件日志: 审计环(内存 500 条) + 可选持久
      const x = Object.assign({ t: now(), seq: ++Sub.seq }, e);
      Sub.journalRing.push(x);
      if (Sub.journalRing.length > 500) Sub.journalRing.shift();
      emit('mycelium:journal', x);
    },
    seq: 0,
    read: ({ since = 0, limit = 200 } = {}) =>
      Sub.journalRing.filter(x => x.t >= since).slice(-limit),
    // 快照: 整库([k,v]) + 块记录, 存进 snapshot:<名>。回滚的权威手段。
    async snapshot(name) {
      const all = await Sub.store.list(''), entries = all.map(e => [e.key, e.value])
        .filter(([k]) => !k.startsWith('snapshot:'));
      const s = { name: name || uid('snap-'), at: now(), n: entries.length, entries };
      await Sub.store.set('snapshot:' + s.name, s);
      Sub.记({ op: 'snapshot', key: s.name, by: 'sub' });
      return { name: s.name, at: s.at, n: s.n };
    },
    snapshots: async () => (await Sub.store.list('snapshot:')).map(e => e.value)
      .sort((a, b) => b.at - a.at),
    async restore(name) {
      const s = await Sub.store.get('snapshot:' + name);
      if (!s) fail(`没有叫「${name}」的快照; 现有: ${(await Sub.snapshots()).map(x => x.name).join(', ')}`);
      const all = await Sub.store.list('');
      for (const e of all) if (!e.key.startsWith('snapshot:')) await Sub.store.del(e.key);
      for (const [k, v] of s.entries) await Sub.store.set(k, v);
      Sub.记({ op: 'restore', key: name, by: 'sub' });
      return { restored: name, keys: s.n, at: s.at };
    },
    async drop(name) { await Sub.store.del('snapshot:' + name); return { dropped: name }; },
  };

  // ══════════ 能力网 ══════════
  // 块、孢子、agent 之间都走这一张表。call 总回 Promise(抛错即拒绝)。
  // 三级权限:
  //   open     直接执行(读数据、算东西)
  //   notice   执行, 但广播 mycelium:notice(界面角标告诉用户"它调了这个")
  //   guarded  要人批准(改块、发消息、花钱的调用)。autonomy 记忆可选。
  // 每次调用留一条 span(示波器看得到), agent 调错的参数在调用前就被形状挡住。
  const Net = {
    CAP: {}, 私: {}, 外: null, spans: [], pending: new Map(), remembered: new Set(),
    认: m => m.caps || [m.id.split(':').pop()],
    头: p => String(p).split('.')[0],
    主: p => L.factory.find(b => Net.认(b.manifest).includes(Net.头(p))),
    provide(path, fn, meta = {}, by) {
      const c = { fn, by, desc: meta.desc || '', schema: meta.schema || null,
        level: meta.level || 'open', frames: meta.frames !== false,
        common: meta.common === true || undefined };
      // 前缀归哪块: 块清单 caps 写它有哪些前缀, 没写就是 id 末截; 内核自己的 hypha.* 总是公开
      const caps = by === 'hypha' ? ['hypha'] : (blockOf(by) ? Net.认(blockOf(by).manifest) : []);
      const T = caps.includes(Net.头(path)) ? Net.CAP : (Net.私[by] ||= {});
      if (T[path] && T[path].by !== by) fail(`能力撞名: ${path} 已由 ${T[path].by} 提供`);
      T[path] = c;
      emit('mycelium:cap', { path, by, type: 'add', level: c.level });
      return () => { delete T[path]; emit('mycelium:cap', { path, by, type: 'remove' }); };
    },
    找: (path, by) => Net.私[by]?.[path] || Net.CAP[path],
    has: (path, by) => !!Net.找(path, by),
    call(path, args, meta = {}) {
      return new Promise((res, rej) => {
        const c = Net.找(path, meta.by);
        if (!c && Net.外) return res(Net.外.call(path, clone({ ...args, stream: false })));
        if (!c) {
          const o = Net.主(path), near = Object.keys(Net.CAP).filter(p => Net.头(p) === Net.头(path)).sort();
          if (o && !L.inst[o.manifest.id]) return rej(new Error(`「${o.manifest.name || o.manifest.id}」块停用了, 调不了 ${path}`));
          return rej(new Error(`无此能力: ${path}` + (near.length ? `。同名空间下有: ${near.join(', ')}` : '。用 hypha.catalog 看清单')));
        }
        if (meta.frame && !c.frames) return rej(new Error(`隔离窗里不能调用 ${path}(它要改宿主)`));
        let a = args ?? {};
        try { checkShape(a, c.schema, path); }
        catch (e) { return rej(e); }
        const span = { id: uid('sp-'), path, by: meta.by || '?', level: c.level, at: now(), args: Net.摘要(a) };
        Net.spans.push(span);
        if (Net.spans.length > 500) Net.spans.shift();
        const done = err => { span.ms = now() - span.at; span.ok = !err; if (err) span.err = err.message; emit('mycelium:span', span); };
        const go = () => Promise.resolve()
          .then(() => c.fn(a, meta))
          .then(v => { done(null); res(v); }, e => { done(e); rej(e); });
        if (c.level === 'open') return go();
        if (c.level === 'notice') { emit('mycelium:notice', { path, by: meta.by, args: span.args, desc: c.desc }); return go(); }
        // guarded: 审批
        const auto = Net.remembered.has(path) && Net.autonomy !== 'ask';
        if (auto || Net.autonomy === 'auto') return go();
        if (!doc()) return rej(new Error(`${path} 要人批准, 但现在没有界面能问(无头环境默认拒绝)`));
        const req = { id: uid('ap-'), path, by: meta.by || '?', args: span.args, desc: c.desc, at: now() };
        Net.pending.set(req.id, { res, rej, span, go, req });
        emit('mycelium:approve', req);
        E.setTimeout(() => {
          if (Net.pending.has(req.id)) Net.decide(req.id, false);
        }, 300000);
      });
    },
    // 脱敏摘要: key/token/secret 打码, 长的截断
    摘要: a => {
      let s;
      try { s = JSON.stringify(a, (k, v) => /key|token|secret|password/i.test(k) ? '***' : v); }
      catch (e) { s = String(a); }
      return s.length > 300 ? s.slice(0, 300) + `…(共 ${s.length} 字)` : s;
    },
    autonomy: 'remember',                // 'ask' 每次问 | 'remember' 记住选择 | 'auto' 不拦
    decide(reqId, ok, remember) {
      const p = Net.pending.get(reqId);
      if (!p) return false;
      Net.pending.delete(reqId);
      if (remember) Net.remembered.add(p.req.path);
      if (ok) p.go(); else {
        const e = new Error(`用户拒绝了 ${p.req.path}`);
        p.span.ok = false; p.span.err = 'rejected'; emit('mycelium:span', p.span);
        p.rej(e);
      }
      return true;
    },
    catalog(by) {
      const T = { ...Net.CAP, ...Net.私[by] || {} };
      return Object.keys(T).sort().map(path => {
        const { fn, ...c } = T[path];
        return { path, desc: c.desc, level: c.level, schema: c.schema,
          args: shapeLine(c.schema), by: c.by, common: c.common };
      });
    },
    revoke(by) { [Net.CAP, Net.私[by] || {}].forEach(T => Object.keys(T).forEach(p => {
      if (T[p].by === by) { delete T[p]; emit('mycelium:cap', { path: p, by, type: 'remove' }); }
    })); },
    trace: ({ path, by, limit = 100 } = {}) => Net.spans.filter(s =>
      (!path || s.path.includes(path)) && (!by || s.by === by)).slice(-limit),
  };
  // 内核自己的能力: 实现它的段末尾登记。level: open 直接跑 / notice 跑但广播 / guarded 要人批准
  const P = (path, fn, desc, schema, frames, level) =>
    Net.provide(path, fn, { desc, schema, frames: frames !== false, common: true, level: level || 'open' }, 'hypha');

  // ══════════ 块接口 ══════════
  // 块代码 = function (ctx, __seg, colony) 的函数体, 不带 function 外壳。
  // ctx: id/root/kv/provide/call/has/on/cleanup/trace/log
  const L = { store: null, factory: [], recs: {}, inst: {}, errors: {}, broken: [],
    safe: false, head: '', launcher: '', stemFactory: '', booting: false };
  const blockOf = id => L.factory.find(b => b.manifest.id === id);
  const ctxFor = id => {
    const cleanups = [];
    let root = null;
    if (doc() && !E?.boot?.headless) {       // 无头(测试)不给 root: 块的界面代码自然不跑
      root = doc().createElement('div');
      root.setAttribute('data-nodule-id', id);
      (doc().getElementById('mycelium-root') || doc().body).appendChild(root);
      cleanups.push(() => root.remove());
    }
    const ctx = {
      id, root,
      provide: (path, fn, meta) => Net.provide(path, fn, meta, id),
      call: (path, args) => Net.call(path, args, { by: id }),
      has: path => Net.has(path, id),
      on: (name, fn) => { const off = on(name, fn); cleanups.push(off); return off; },
      trace: msg => { Sub.记({ op: 'log', key: id, by: id, note: String(msg).slice(0, 200) }); },
      log: (...a) => console.log('[' + id + ']', ...a),
      cleanup: fn => cleanups.push(fn),
      // kv 是全库共享; 块记录不让直接写, 因为那是 setNodule 的地盘
      kv: guardKv({
        get: k => Sub.get(k), set: (k, v) => Sub.set(k, v, id), del: k => Sub.del(k, id),
        list: p => Sub.list(p),
      }),
    };
    const colony = { call: ctx.call, has: ctx.has, get solo() { return !!BOOT.solo; } };
    return { ctx, cleanups, colony };
  };
  const guardKv = store => {           // 块记录只能经 setNodule 改
    const chk = k => String(k).startsWith('block:')
      ? Promise.reject(new Error('块记录只能经 hypha.setNodule 改: ' + k)) : Promise.resolve();
    return { get: k => store.get(k), set: (k, v) => chk(k).then(() => store.set(k, v)),
      del: k => chk(k).then(() => store.del(k)), list: p => store.list(p) };
  };

  // ══════════ 段值表 ══════════
  // 借用方拿到懒取值代理: 值不靠装载顺序, 源头晚到靠 mycelium:cap 事件接上
  const SEG = {};
  const segRef = (key, why) => {
    const peek = () => { try { return SEG[key]; } catch (e) { } }, get = () => {
      const v = peek();
      if (v === undefined) {
        const src = key.split('/')[0], b = blockOf(src), 开 = b && isEnabled(b);
        fail(b && 停(src) ? `源头块 ${src} ${开 ? '坏了' : '已禁用'}, 借不到 ${key}`
          + (why ? `; 剪不出一份来: ${why}` : '') + `: ${开 ? '修好' : '启用'}它, 或把这段复制过来`
          : `借的段还没就位: ${key}(源头块从未装载, 或它没有这个名字的段)`);
      }
      if (Object(v) !== v) fail(`借的 ${key} 是单个的值, 借过来是个代理, 用不了: 请包成对象`);
      return v;
    };
    return new Proxy(function () { }, {
      apply: (_, t, a) => get().apply(t, a),
      construct: (_, a) => Reflect.construct(get(), a),
      get: (_, p) => {
        if (typeof p !== 'string' || p === 'then' || p === 'toJSON') {
          const v = peek();
          return v == null ? undefined : v[p];
        }
        return get()[p];
      },
      set: (_, p, v) => { get()[p] = v; return true; },
      has: (t, p) => p in get() || p in t,
    });
  };
  // 段名/范围名都登记; 映射段生成 const 名 = __seg.ref('块/名')
  const forRun = (id, eff) => {
    const out = eff.prologue.slice();
    new Set(eff.segs.map(s => s.name).concat(Object.keys(lay(eff, id, 1).need))).forEach(n => {
      if (isIdent(n)) out.push(`__seg.set(${JSON.stringify(n)}, () => ${n});`);
    });
    eff.segs.forEach(s => {
      if (s.map) {
        if (!isIdent(s.name)) fail(`段名「${s.name}」不是合法标识符, 不能映射`);
        out.push(s.lines[0], `const ${s.name} = __seg.ref(${JSON.stringify(s.map.block + '/' + s.map.name)});`,
          ...s.lines.slice(1));
      } else out.push(headLine({ ...s, borrowers: [] }), ...s.lines.slice(1));
    });
    return out.join('\n');
  };
  const 停 = x => (x = blockOf(x)) && !(isEnabled(x) && !L.errors[x.manifest.id]);
  const 问来 = {};                     // 按需问来的(借用方跑起来才问得到)
  // 停用/坏掉的源头: 导出一个没有它的 Mycelium 时的那份(换剪一份), 剪不出的照旧借
  const 跑码 = b => {
    const id = b.manifest.id, eff = checkSegs(effectiveOf(b), id), 不 = {};
    return { 不, code: forRun(id, eff.segs.some(s => s.map && 停(s.map.block))
      ? parseSegs(换(joinSegs(eff), id, { has: x => !停(x) }, 问来, {}, 不).code) : eff) };
  };
  const 重剪 = async () => {
    const bs = L.factory.filter(b => L.inst[b.manifest.id]
      && effectiveOf(b).segs.some(s => s.map && blockOf(s.map.block)));
    Object.assign(问来, await 问(bs.filter(b => effectiveOf(b).segs.some(s => s.ask && 停(s.map?.block)))));
    const re = bs.filter(b => L.inst[b.manifest.id] && b._run !== 跑码(b).code);
    re.forEach(b => { dispose(b.manifest.id); tryRun(b); });
    if (re.length) emit('mycelium:blocks');
  };

  // ══════════ 装载 ══════════
  const isEnabled = b => {
    const r = L.safe ? null : L.recs[b.manifest.id];
    return r?.enabled !== undefined ? !!r.enabled : !b.adopted && !b.tagDisabled;
  };
  const instantiate = b => {
    const id = b.manifest.id;
    if (L.inst[id]) return;
    if (!isEnabled(b)) { L.errors[id] = '已禁用'; return; }
    const o = ctxFor(id);
    let seg = null;
    try {
      const r = 跑码(b);
      o.colony.停着 = x => 停(x) && (blockOf(x).manifest.name || x);
      b._run = r.code;
      checkCode(b._run, id);
      seg = {
        set: (n, get) => Object.defineProperty(SEG, id + '/' + n, { get, enumerable: true, configurable: true }),
        ref: k => segRef(k, r.不[k]),
        clear: () => Object.keys(SEG).forEach(k => { if (k.startsWith(id + '/')) delete SEG[k]; }),
      };
      const ret = new Function(...块参, b._run)(o.ctx, seg, o.colony);
      L.inst[id] = Object.assign(o, { dispose: ret?.dispose || null });
      delete L.errors[id];
    } catch (e) {
      o.cleanups.forEach(f => { try { f(); } catch (_) { } });
      Net.revoke(id);
      if (seg) seg.clear();
      L.errors[id] = 块参错(e) || e.message;
      throw e;
    }
  };
  const tryRun = b => { try { instantiate(b); } catch (e) { console.error('[nodule]', b.manifest.id, e); } };
  const 被借的先 = 序 => {              // 被借的先装: 源头坏了先露出来, 借它的装时就剪一份
    const 剩 = 序.splice(0), 借着 = b => effectiveOf(b).segs.some(s => 剩.some(x => x !== b
      && x.manifest.id === s.map?.block));
    while (剩.length) 序.push(...剩.splice(Math.max(0, 剩.findIndex(b => !借着(b))), 1));
  };
  const assembleAll = async () => {
    L.booting = true; L.errors = {}; L.broken = [];
    L.factory = [];
    if (doc()) doc().querySelectorAll(`${SCR}[type="mycelium/nodule"]`).forEach(el => {
      try {
        const b = parseBlock(el.textContent);
        if (blockOf(b.manifest.id)) fail('块 id 重复: ' + b.manifest.id);
        if (el.getAttribute('data-disabled')) b.tagDisabled = true;
        L.factory.push(b);
      } catch (e) { L.broken.push({ id: el.getAttribute('data-id') || '?', error: e.message }); }
    });
    L.recs = {};
    for (const e of await Sub.list('block:')) {
      const id = String(e.key).slice(6);
      L.recs[id] = e.value;
      if (!L.safe && e.value?.adopted && !blockOf(id)) {
        try { L.factory.push(Object.assign(parseBlock(e.value.adopted), { adopted: true })); }
        catch (err) { L.broken.push({ id, error: '收养记录损坏: ' + err.message }); }
      }
    }
    const 序 = L.factory.slice().sort((a, b) => a.manifest.id < b.manifest.id ? -1 : 1);
    被借的先(序);
    序.forEach(tryRun);
    await 重剪();
    L.booting = false;
    emit('mycelium:blocks');
  };
  const dispose = id => {
    const i = L.inst[id];
    if (!i) return;
    try { if (i.dispose) i.dispose(); } catch (e) { console.error('[dispose]', id, e); }
    i.cleanups.forEach(f => { try { f(); } catch (_) { } });
    Net.revoke(id);
    delete L.inst[id];
  };

  // ══════════ 块记录与改块 ══════════
  // 记录: {enabled?, adopted?, segs:{名:{edited, active}}, order?, prologue?, layoutActive?}
  // 原版永远在出厂文本里, 改版在记录里, active 说哪份显性
  const recKey = id => 'block:' + id;
  const effective = (factory, rec) => {
    const fp = typeof factory === 'string' ? parseSegs(factory) : factory, byName = {},
      segsRec = rec?.segs || {}, useLayout = rec?.layoutActive === 'edited',
      names = useLayout && rec.order ? rec.order.slice() : fp.segs.map(s => s.name), segs = [], deleted = [];
    fp.segs.forEach((s, i) => {
      byName[s.name] = s;
      if (!names.includes(s.name)) names.splice(Math.min(i, names.length), 0, s.name);
    });
    Object.keys(segsRec).forEach(n => { if (!names.includes(n)) names.splice(Math.max(names.length - 1, 0), 0, n); });
    names.forEach(n => {
      const r = segsRec[n], f = byName[n], hasEdit = !!r?.edited;
      if (r?.active === 'edited' && r.edited != null) {
        if (r.edited === '') return deleted.push(n);
        const lines = r.edited.split('\n');
        segs.push(Object.assign(mark(lines[0]) || blank(n), { name: n, text: r.edited, lines,
          use: 'edited', hasEdit, factoryText: f ? f.text : null }));
      } else if (f) segs.push(Object.assign({}, f, { use: 'factory', hasEdit, factoryText: f.text }));
    });
    return { prologue: useLayout && typeof rec.prologue === 'string' ? rec.prologue.split('\n') : fp.prologue,
      segs, deleted };
  };
  const effectiveOf = b => effective(parsedOf(b), L.safe ? null : L.recs[b.manifest.id]);
  const parsedOf = b => b._p?.src === b.code ? b._p : (b._p = Object.assign(parseSegs(b.code), { src: b.code }));
  const revOf = id => hash(id === 'hypha' ? stemUse() + stemEdited() : JSON.stringify(L.recs[id] || null));
  const 改版 = edited => ({ edited, active: 'edited' });
  // 记一段: 和出厂一字不差就不算改过, 否则存成显性改版
  const 记 = (b, rec, s) => parsedOf(b).segs.some(f => f.name === s.name && segKey(f) === segKey(s))
    ? (rec.segs[s.name]?.active === 'factory' || delete rec.segs[s.name])
    : (rec.segs[s.name] = 改版(s.text));
  const applyEdits = (b, rec, edits, id) => {
    if (!Array.isArray(edits)) fail('edits 要是数组');
    edits.forEach(sg => {
      if (!sg || typeof sg.name !== 'string') fail('segment 要有 name');
      const cur = effective(parsedOf(b), rec).segs.find(s => s.name === sg.name);
      let text = sg.text;
      if (sg.replace !== undefined) {          // replace 只换对上的那一处: 比整段重写稳
        if (text !== undefined) fail('text(整段重写)和 replace(只换几处)只能给一个');
        text = (cur || fail('无此段: ' + sg.name)).text;
        [].concat(sg.replace).forEach(r => {
          if (!r || typeof r.old !== 'string' || !r.old || typeof r.new !== 'string')
            fail('replace 每项要 {old, new}, 都是字符串, old 不能空');
          const n = text.split(r.old).length - 1;
          if (n !== 1) fail(`段 ${sg.name} 里${n ? `有 ${n} 处` : '找不到'}「${r.old.slice(0, 40)}」: old 要和原文一字不差, 且只对上一处`);
          text = text.replace(r.old, () => r.new);
        });
      }
      if (typeof text === 'string') {
        text = norm(text);
        checkCode(text, id);
        const p = parseSegs(text);
        if (p.prologue.length || p.segs.length !== 1 || p.segs[0].name !== sg.name)
          fail(`段文本必须以这段自己的段头开头, 且只含这一段: ${sg.name}`);
        记(b, rec, p.segs[0]);
      } else if (text === null) rec.segs[sg.name] = 改版('');   // 删段
      if (sg.active !== undefined) {
        if (sg.active !== 'edited' && sg.active !== 'factory') fail("active 只能是 'edited' 或 'factory'");
        if (!rec.segs[sg.name]) fail(`段 ${sg.name} 没有改版, 无从切换`);
        rec.segs[sg.name].active = sg.active;
      }
    });
  };
  const checkCode = (code, id) => {
    if (/<\/script/i.test(code)) fail(`块 ${id} 含字面闭合标签, 请写成 <\\/${SCR}>`);
    if (new RegExp('<!--[\\s\\S]*?<' + SCR, 'i').test(code))
      fail(`块 ${id} 里 <!-- 与 <${SCR} 同现会打乱 HTML 解析, 请写成 "<!" + "--"`);
  };
  const checkManifest = m => {
    if (typeof m.id !== 'string' || !/^[^"<>\/\s]+$/.test(m.id))
      fail('清单 id 不合法(不能含引号、尖括号、斜杠、空白; 斜杠是"块/段"的分隔): ' + JSON.stringify(m.id));
    if (m.version !== undefined && typeof m.version !== 'number') fail('清单 version 必须是数字');
    if (m.name !== undefined && typeof m.name !== 'string') fail('清单 name 必须是字符串');
    if (m.caps && !(Array.isArray(m.caps) && m.caps.every(x => typeof x === 'string')))
      fail('清单 caps 必须是字符串数组');
  };
  const parseBlock = text => {
    const s = norm(text);
    let m = /\/\*NODULE\*\/([\s\S]*?)\/\*CODE\*\//.exec(s), manifest, code;
    if (m) {                                   // 单文件里的规范形式
      manifest = JSON.parse(m[1].trim());
      code = norm(s.slice(m.index + m[0].length));
    } else {                                   // 开发态块文件: 头一行是注释, 文件本身就是合法 JS
      const h = /^\/\/ @nodule (\{[\s\S]*?\})\s*\n/.exec(s)
        || fail('块缺少 /*NODULE*/{清单}/*CODE*/ 头, 也没有 // @nodule {清单} 注释头');
      manifest = JSON.parse(h[1]);
      code = norm(s.slice(h[0].length));
    }
    checkManifest(manifest);
    return { manifest, code };
  };
  const blockTag = (manifest, code, disabled) => {
    checkManifest(manifest);
    checkCode(code, manifest.id);
    return `<${SCR} type="mycelium/nodule" data-id="${manifest.id}"`
      + `${disabled ? ' data-disabled="1"' : ''}>${blockText(manifest, code)}</${SCR}>`;
  };
  const blockText = (manifest, code) => `\n/*NODULE*/${JSON.stringify(manifest)}/*CODE*/\n${norm(code)}\n`;
  const findBlockTags = (html, onError) => {
    const re = new RegExp(`<${SCR}(\\s[^>]*type="mycelium/nodule"[^>]*)>([\\s\\S]*?)</${SCR}>`, 'g'), out = [];
    for (const m of html.matchAll(re)) {
      try {
        const b = parseBlock(m[2]);
        if (/data-disabled=/.test(m[1])) b.tagDisabled = true;
        out.push(b);
      } catch (e) { if (!onError) throw e; onError(e, (/data-id="([^"]*)"/.exec(m[1]) || [])[1] || '?'); }
    }
    return out;
  };
  const findLineage = html => {
    const m = /<!--MYCELIUM-LINEAGE ([\s\S]*?)-->/.exec(html);
    return m ? JSON.parse(m[1]) : null;
  };

  // 自报/技能: 块的自我说明(只有注释, 给人看也给 agent 看)
  //   自报: 头一句用处; 「数据 {…}」认一个数据前缀; 「现在 X」此刻的样子; 「打开 X」点开它时调
  //   技能: 「// 【名】什么时候读: 做法…」开一条
  const aboutOf = eff => {
    const o = { desc: '', data: [], skills: [] }, 段 = n => eff.segs.find(s => s.name === n)?.lines || [];
    段('自报').slice(1).forEach(l => {
      const [, k, v] = /^\/\/ (数据|现在|打开) (.*)/.exec(l) || [];
      if (k === '数据') { try { o.data.push(JSON.parse(v)); } catch (e) { o.data.push({ error: l }); } }
      else if (k) o[k === '现在' ? 'show' : 'open'] = v.trim();
      else if (!o.data.length && /^\/\/ \S/.test(l)) o.desc += l.slice(3);
    });
    段('技能').forEach(l => {
      const m = /^\/\/ 【(.+?)】(.*)/.exec(l);
      if (m) o.skills.push({ name: m[1], when: m[2].split(/[:：。] ?/)[0].slice(0, 40) });
    });
    return o;
  };
  const borrowTable = () => {
    const t = {};
    L.factory.forEach(b => effectiveOf(b).segs.forEach(s => {
      const k = s.map && s.map.block !== b.manifest.id && s.map.block + '/' + s.map.name;
      if (k) (t[k] ||= []).push(b.manifest.id);
    }));
    return t;
  };
  const 谁要 = id => {
    const q = id === 'hypha' ? parseSegs(stemTextNow()) : effectiveOf(块(id)), R = lay(q, id, 1), out = {},
      记 = (ns, by) => ns.forEach(n => (out[n] ||= []).includes(by) || out[n].push(by));
    [stemBlock()].concat(L.factory).forEach(y => effectiveOf(y).segs.forEach(s => {
      if (s.map?.block !== id || y.manifest.id === id) return;
      const [r, g] = 连(R, [s.map.name].concat(s.want));
      记([...r].concat([...g].map(i => q.segs[i].name)), y.manifest.id);
    }));
    Object.values(R.need).concat(q.segs.map(s => s.follows)).forEach(ns => 记(ns, id));
    return out;
  };
  const outline = (b, t) => {
    const id = b.manifest.id, eff = effectiveOf(b), inst = L.inst[id], tab = t || borrowTable();
    return { id, name: b.manifest.name || id, icon: b.manifest.icon || '', about: aboutOf(eff),
      version: b.manifest.version || 0, enabled: isEnabled(b), adopted: !!b.adopted, running: !!inst,
      hidden: inst?.ctx.root?.style.display === 'none', error: L.errors[id] || null,
      deleted: eff.deleted, segs: eff.segs.map(s => ({ name: s.name, v: s.v, lines: s.lines.length,
        use: s.use, hasEdit: s.hasEdit, map: s.map, from: s.from, follows: s.follows,
        borrowers: (tab[id + '/' + s.name] || []).slice() })) };
  };
  const 块 = id => blockOf(id) || fail('无此块: ' + id);
  const 回 = (b, x) => {
    const e = effectiveOf(b), id = b.manifest.id;
    return Object.assign({ id, error: L.errors[id] || null, deleted: e.deleted,
      edited: e.segs.filter(s => s.use === 'edited').map(s => s.name) }, x);
  };
  // 预览: 逐段改动和字节差
  const 预览 = async (A, B) => {
    const list = e => [{ name: '(前言)', text: e.prologue.join('\n') }].concat(e.segs);
    const a = list(A), b = list(B), 文 = (xs, n) => xs.find(s => s.name === n)?.text || '', changes = [];
    for (const name of new Set(a.concat(b).map(s => s.name))) {
      const before = 文(a, name), after = 文(b, name);
      if (before !== after) changes.push({ name, bytes: new TextEncoder().encode(after).length
        - new TextEncoder().encode(before).length });
    }
    return { changes, bytes: changes.reduce((n, c) => n + c.bytes, 0) };
  };
  const 源头段没了 = async (srcId, removed, oldEff) => {   // 借用方自动得到一份复制并变显性
    for (const b of L.factory) {
      const id = b.manifest.id;
      if (id === srcId) continue;
      const rec = L.recs[id] || { segs: {} }, eff = effectiveOf(b), have = 有(eff),
        cut = eff.segs.filter(s => s.map?.block === srcId && removed.includes(s.map.name)
          && oldEff.segs.some(x => x.name === s.map.name));
      rec.segs = rec.segs || {};
      if (!cut.length) continue;
      copyOf(oldEff, srcId, cut.map(s => [s, s.map.name]), have).forEach((t, i) => {
        rec.segs[cut[i].name] = 改版(t);
      });
      L.recs[id] = rec;
      await Sub.set(recKey(id), rec, 'hypha');
      dispose(id); tryRun(b);
    }
  };
  const setNoduleNow = async a => {
    const id = a.id || fail('缺 id');
    if (id === 'hypha') return setStem(a);
    if (!['code', 'enabled', 'segment', 'edits', 'remove', 'hidden'].some(k => a[k] !== undefined))
      fail('没有要改的内容: 给 code / enabled / segment / edits / remove / hidden 之一');
    const b = 块(id);
    if (a.expected !== undefined && a.expected !== revOf(id))
      fail(`${id} 在你读过之后被改过了, 请重新读一遍再改(基线号对不上)`);
    if (a.hidden !== undefined && !a.preview) {
      const inst = L.inst[id];
      if (inst && inst.ctx.root) inst.ctx.root.style.display = a.hidden ? 'none' : '';
      if (Object.keys(a).length === 2) { emit('mycelium:blocks'); return 回(b); }
    }
    if (L.safe) fail('安全模式只读, 改块无效(?safe=1 中, 或改版内核已连续崩溃被切回原版)');
    const oldEff = effectiveOf(b), on0 = isEnabled(b);
    if (a.remove) {
      if (!b.adopted) fail('只有收养块能移除; 出厂块用 enabled:false 禁用');
      dispose(id);
      delete L.recs[id];
      await Sub.del(recKey(id), 'hypha');
      L.factory = L.factory.filter(x => x !== b);
      delete L.errors[id];
      await 源头段没了(id, oldEff.segs.filter(s => !s.map).map(s => s.name), oldEff);
      emit('mycelium:blocks');
      return { id, removed: true };
    }
    const prev = clone(L.recs[id]), rec = clone(L.recs[id]) || { segs: {} };
    rec.segs = rec.segs || {};
    if (a.code === null) {
      Object.values(rec.segs).forEach(s => { s.active = 'factory'; });
      if (rec.order !== undefined || rec.prologue !== undefined) rec.layoutActive = 'factory';
    } else if (typeof a.code === 'string') {
      const code = norm(a.code);
      checkCode(code, id);
      const fp = parsedOf(b), np = checkSegs(parseSegs(code), id), segs = rec.segs,
        fnames = fp.segs.map(s => s.name), nnames = np.segs.map(s => s.name),
        sameOrder = nnames.join('\u0001') === fnames.join('\u0001'),
        samePro = np.prologue.join('\n') === fp.prologue.join('\n');
      np.segs.forEach(s => 记(b, rec, s));
      new Set(fnames.concat(Object.keys(segs))).forEach(n => {
        if (!nnames.includes(n)) fnames.includes(n) ? (segs[n] = 改版('')) : delete segs[n];
      });
      if (sameOrder && samePro) ['order', 'prologue', 'layoutActive'].forEach(k => delete rec[k]);
      else Object.assign(rec, { order: sameOrder ? undefined : nnames,
        prologue: samePro ? undefined : np.prologue.join('\n'), layoutActive: 'edited' });
    } else if (a.code !== undefined) fail('code 只能是字符串(整块改写)或 null(恢复出厂)');
    applyEdits(b, rec, a.edits || (a.segment ? [a.segment] : []), id);
    if (a.enabled !== undefined) rec.enabled = !!a.enabled;
    const eff = effective(parsedOf(b), rec);
    const run = forRun(id, checkSegs(eff, id));
    const revision = revOf(id), on1 = rec.enabled === undefined ? on0 : rec.enabled,
      changed = JSON.stringify(prev || { segs: {} }) !== JSON.stringify(rec),
      restart = run !== forRun(id, oldEff) || on0 !== on1 || (on1 && !L.inst[id]);
    checkCode(run, id);
    syntax(run, '没有改动: 新版本', 块参);      // 语法不过就不动正在跑的那份
    if (a.preview) return Object.assign({ id, preview: true, revision, changed, restart }, await 预览(oldEff, eff));
    if (!changed && !restart) return 回(b, { revision, changed, restarted: false });
    L.recs[id] = rec;
    const was = !!L.inst[id];
    if (restart) {
      dispose(id);
      try { instantiate(b); }
      catch (e) {                            // 新版本初始化失败: 回滚旧版
        if (prev) L.recs[id] = prev; else delete L.recs[id];
        dispose(id);
        let back = '';
        if (was || !isEnabled(b)) { try { instantiate(b); } catch (e2) { back = '; 回滚旧版也失败: ' + e2.message; } }
        fail('新版本初始化失败, 已回滚: ' + e.message + back);
      }
    }
    if (!on0 && on1) await 认亲([id]);
    await Sub.set(recKey(id), rec, 'hypha');
    const removed = oldEff.segs.filter(s => !s.map && !eff.segs.some(n => n.name === s.name)).map(s => s.name);
    if (removed.length) await 源头段没了(id, removed, oldEff);
    emit('mycelium:blocks');
    return 回(b, { revision: revOf(id), changed, restarted: restart });
  };
  const QUEUE = {};
  const setNodule = a => {                   // 同一块的写入排队; 写完照现在谁在跑重剪借用方
    a = a || {};
    if (a.preview) return setNoduleNow(a);
    return QUEUE[a.id] = (QUEUE[a.id] || Promise.resolve()).catch(() => { })
      .then(() => setNoduleNow(a)).finally(重剪);
  };
  // 内核自己也是"一块"(id: hypha): 整段文本, 改完要重载
  const stemUse = () => LS()?.getItem(BOOT.key + '.use') || 'factory';
  const stemEdited = () => LS()?.getItem(BOOT.key + '.edited') || '';
  const stemTextNow = () => (stemUse() === 'edited' && stemEdited()) || L.stemFactory;
  const stemBlock = () => ({ manifest: { id: 'hypha', name: 'Hypha' }, code: stemTextNow() });
  const setStem = async a => {
    if (!LS()) fail('此环境没有 localStorage, 不能改内核');
    if (a.expected !== undefined && a.expected !== revOf('hypha'))
      fail('内核在你读过之后被改过了, 请重新读一遍再改');
    const edits = a.edits || (a.segment ? [a.segment] : []);
    let edited = stemEdited(), use = stemUse();
    if (a.code === undefined && a.active === undefined && !edits.length)
      fail('改内核要给 code(字符串或 null)、segment / edits 或 active');
    if (a.code === null) use = 'factory';
    else if (typeof a.code === 'string') [edited, use] = [a.code, 'edited'];
    else if (a.code !== undefined) fail('code 只能是字符串或 null');
    if (edits.length) {
      const rec = { segs: {} };
      applyEdits(stemBlock(), rec, edits, 'hypha');
      [edited, use] = [joinSegs(effective(parsedOf(stemBlock()), rec)), 'edited'];
    }
    if (a.active !== undefined) {
      if (a.active !== 'edited' && a.active !== 'factory') fail("active 只能是 'edited' 或 'factory'");
      if (a.active === 'edited' && !edited) fail('内核没有改版, 无从切换');
      use = a.active;
    }
    if (norm(edited) === norm(L.stemFactory)) [edited, use] = ['', 'factory'];
    if (use === 'edited') {
      checkCode(edited, 'hypha');
      lay(parseSegs(edited), 'hypha');
      syntax(edited, '没有保存: 改版内核');
    }
    const changed = edited !== stemEdited() || use !== stemUse();
    if (a.preview) return { id: 'hypha', preview: true, revision: revOf('hypha'), changed };
    if (edited !== stemEdited()) LS().setItem(BOOT.key + '.edited', edited);
    LS().setItem(BOOT.key + '.use', use);
    return { id: 'hypha', needReload: changed, use, hasEdit: !!edited, changed };
  };

  // ══════════ 收养(导入) ══════════
  // 未知 id 零执行落库、默认禁用; 已知 id 导入版上岗、原来的退成隐性。
  // 复制用「换」换回借用行, 换不回的保留; 离体占位按号找回。
  const 在场 = ids => new Set(L.factory.filter(b => isEnabled(b) && (!ids || ids.includes(b.manifest.id)))
    .map(b => b.manifest.id));
  const 补 = (code, old) => {
    const L2 = lay(parseSegs(code), ''), O = lay(parseSegs(old ?? ''), '', 1), at = {}, 缺 = [];
    Object.entries(L2.处).forEach(([n, i]) => {
      const j = O.处[n];
      if (L2.pair[i] !== i + 1) return;      // 导进来的这处有内容: 照它的
      if (O.pair[j] > j) at[i] = O.lines.slice(j, O.pair[j]);
      else 缺.push(n);
    });
    return { code: L2.lines.flatMap((l, i) => at[i] || [l]).join('\n'), 缺 };
  };
  const 隐了 = (b, 隐) => 隐.filter(x => parsedOf(b).segs.some(f => f.name === x.name
    && segKey(f) !== segKey(parseSegs(x.text).segs[0])));
  const 认亲 = async ids => {
    const out = [];
    for (const b of L.factory.slice()) {
      const id = b.manifest.id, e = effectiveOf(b), code = joinSegs(e),
        r = !ids.includes(id) && e.segs.some(s => s.from && ids.includes(s.from.block))
          && 换(code, id, 在场(ids), null);
      if (!r || r.code === code) continue;
      await setNodule({ id, code: r.code, edits: 隐了(b, r.隐) });
      out.push({ id, result: `源自 ${ids} 的复制换回了借用行, 复制留作隐性改版` });
    }
    return out;
  };
  const adopt = async a => {
    if (typeof a?.text !== 'string') fail('adopt 要 {text: 文件内容}');
    const out = [], bs = findBlockTags(a.text, (e, id) => out.push({ id, result: '✗ 无法解析: ' + e.message }));
    if (!bs.length && !out.length) fail('未发现 Nodule 块(需要 mycelium/nodule 标签)');
    for (const b of bs) {
      const id = b.manifest.id, old = blockOf(id);
      try {
        checkCode(b.code, id);
        checkSegs(parseSegs(b.code), id);
        const 前 = old && joinSegs(effectiveOf(old)), f = 补(b.code, 前), r = 换(f.code, id, 在场(), null),
          note = (r.隐.length ? `; ${r.隐.length} 段复制换回了借用行, 复制留作隐性改版` : '')
            + (r.留.length ? '; 段 ' + r.留.map(([s, w]) => `${s.name}(${w})`).join('、') + ' 保留复制' : '')
            + (f.缺.length ? `; 少了 ${f.缺.length} 处只在本系统里用的代码(${f.缺.join('、')}), 要完整的请导出带内核的一代` : '');
        if (old) {
          const pr = L.recs[id], hadEdit = !!(pr?.segs && Object.values(pr.segs).some(s => s.edited));
          await setNodule({ id, code: r.code, edits: 隐了(old, r.隐) });
          out.push({ id, result: (joinSegs(effectiveOf(old)) !== 前
            ? (hadEdit ? '已导入为显性(原改版已被替换, 出厂原版仍为隐性)' : '已导入为显性(原来的退为隐性)')
            : '与现有一致, 未变') + note });
        } else {
          const rec = { adopted: blockText(b.manifest, r.code), enabled: false, segs: {} };
          r.隐.forEach(x => { rec.segs[x.name] = { edited: x.text, active: 'factory' }; });
          L.recs[id] = rec;
          await Sub.set(recKey(id), rec, 'hypha');
          L.factory.push({ manifest: b.manifest, code: norm(r.code), adopted: true });
          L.errors[id] = '已收养(禁用)';
          out.push({ id, result: '已收养(禁用, 启用后上岗)' + note });
        }
      } catch (e) { out.push({ id, result: '✗ 导入失败: ' + e.message }); }
    }
    out.push(...await 认亲(bs.map(b => b.manifest.id)));
    emit('mycelium:blocks');
    return out;
  };

  // ══════════ 导出 ══════════
  const 源 = id => id === 'hypha' ? parseSegs(stemTextNow()) : blockOf(id) && effectiveOf(blockOf(id));
  const 真 = (o, 在) => {                    // 往上找真源头, 最多 9 层
    for (let n = 9, t; n-- && !在(o.block) && (t = 源(o.block)?.segs.find(x => x.name === o.name))?.map;)
      o = t.map;
    return o;
  };
  // 换: 导出时真源头在场就改指, 不在就同源几行合剪一份; 导回(带 = null)时对得上的复制整组换回借用行
  const 换 = (code, id, 在场, 带, 号 = {}, 不) => {
    const p = parseSegs(code), have = 有(p), 组 = {}, 隐 = [], 留 = [], 回 = 带 === null,
      在 = x => x === 'hypha' || 在场.has(x),
      映 = (s, o) => [headLine({ ...blank(s.name), map: o, v: o.v, want: s.want, ask: s.ask })],
      由 = (s, o, q = 源(o.block)) => !q ? '源头不在' : !在(o.block) ? '源头已禁用'
        : !q.segs.some(x => x.name === o.name) && !Object.hasOwn(lay(q, o.block, 1).need, o.name) ? '源头没这名字了'
          : s.name !== o.name ? '名字和源头的不同' : !s.sum ? '老格式, 请从新版重新导出'
            : 纹(bodyOf(s)) !== s.sum ? '改过, 已分叉' : '';
    p.segs.forEach(s => {
      const o = 回 ? s.from : s.map, t = o && o.block !== id && 真(o, 回 ? () => 0 : 在);
      if (!t) return;
      if (回 && s.map) { if (在(o.block)) s.lines = 映(s, o); }
      else if (回 || !在(t.block)) (组[t.block] ||= []).push([s, 回 ? 由(s, o) : t.name]);
      else if (t !== o) s.lines = [headLine({ ...s, map: t, from: s.from || { v: s.v, ...o } })];
    });
    Object.entries(组).forEach(([k, g]) => {
      if (!回) {
        const se = 源(k) || fail(`导出 ${id}: 借的 ${k}/${g[0][1]} 在本系统里不存在, 无法复制`);
        g.forEach(([s]) => { s.got = 带[id + '/' + s.name] || []; });
        copyOf(se, k, g, have, 号[id + '/' + g[0][0].name] = [], 不)
          ?.forEach((t, i) => { g[i][0].lines = t.split('\n'); });
      } else if (g.some(x => x[1])) g.forEach(([s, w]) => 留.push([s, w || '同组有别的换不回']));
      else g.forEach(([s]) => { 隐.push({ name: s.name, text: s.text, active: 'factory' }); s.lines = 映(s, s.from); });
    });
    return { code: joinSegs(p), 隐, 留 };
  };
  const 剪 = (code, solo) => solo ? cutCode(code, null) : code;
  const exportBlocks = (sel, 在场, 带, solo, st = '', 号) => {
    const by = {}, out = sel.map(b => {
      const code = 换(joinSegs(effectiveOf(b)), b.manifest.id, 在场, 带 || {}, 号).code;
      return { manifest: b.manifest, code: 剪(code, solo), disabled: !isEnabled(b) };
    });
    [{ manifest: { id: 'hypha' }, code: st }].concat(out).forEach(e => parseSegs(e.code).segs.forEach(s => {
      if (s.map) (by[s.map.block + '/' + s.map.name] ||= []).push(e.manifest.id);
    }));
    out.forEach(e => {
      const p = parseSegs(e.code);
      p.segs.forEach(s => s.map || (s.lines[0] = headLine(Object.assign({}, s,
        { borrowers: (by[e.manifest.id + '/' + s.name] || []).sort() }))));
      e.code = joinSegs(p);
    });
    return out;
  };
  const buildHtml = (head, lineageRaw, stemText, launcher, blocks) => [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    head,
    '<body>',
    '<!--MYCELIUM-LINEAGE ' + lineageRaw + '-->',
    '<div id="mycelium-root"></div>',
    '<' + SCR + ' id="hypha">' + stemText + '</' + SCR + '>',
    '<' + SCR + ' id="hypha-launcher">' + launcher + '</' + SCR + '>',
  ].concat(blocks.map(b => blockTag(b.manifest, b.code, b.disabled || b.tagDisabled)), ['</body>', '</html>']).join('\n');
  const 拼 = (stemText, blocks, swap, head = L.head, 启 = L.launcher) => {
    blocks = blocks.map(b => {
      const p = swap?.id === b.manifest.id && parseSegs(b.code),
        s = p && p.segs.find(x => x.name === swap.name), h = s && mark(String(swap.text).split('\n')[0]);
      if (!s) return b;
      if (!h || h.cut || h.name !== s.name) fail(`swap.text 第一行得是「${s.name}」的段头`);
      s.lines = String(swap.text).split('\n');
      return Object.assign({}, b, { code: joinSegs(p) });
    });
    const lin = { id: '', parent: BOOT.id, blocks: blocks.map(b => ({ id: b.manifest.id, version: b.manifest.version || 0 })) },
      body = raw => buildHtml(head, raw, stemText, 启, blocks);
    lin.id = hash(body(''));
    return body(JSON.stringify(lin));
  };
  const parts = html => {
    const grab = (re, what) => {
      const m = re.exec(html);
      if (!m) fail('文件里找不到 ' + what);
      return m[1];
    };
    return {
      head: grab(/(<head>[\s\S]*?<\/head>)/, '<head>'),
      lineageRaw: grab(/<!--MYCELIUM-LINEAGE ([\s\S]*?)-->/, '血统'),
      stemText: grab(new RegExp('<' + SCR + ' id="hypha">([\\s\\S]*?)</' + SCR + '>'), '内核'),
      launcher: grab(new RegExp('<' + SCR + ' id="hypha-launcher">([\\s\\S]*?)</' + SCR + '>'), '启动器'),
      blocks: findBlockTags(html),
    };
  };
  // 门禁: 导出件必须自洽 —— 拆开再拼回一字不差、映射不悬空、语法过、血统对得上
  const gates = (html, swap, solo) => {
    const errs = [], p = parts(html), ids = new Set(), dup = new Set(), 名 = {},
      认 = (id, code) => {
        try {
          const q = checkSegs(parseSegs(code), id);
          名[id] = new Set(q.segs.map(s => s.name).concat(Object.keys(lay(q).need)));
          try { new Function(...(id === 'hypha' ? [] : 块参), code); }
          catch (e) {
            const n = 重名(e), 参 = id !== 'hypha' && 块参错(e);
            errs.push(id + (参 ? ': ' + 参 : n ? `: 剪进来的代码和它自己的撞名「${n}」, 请改掉一边` : ' 有语法错误: ' + e.message));
          }
          return q;
        } catch (e) { errs.push(id + ': ' + e.message); }
      };
    if (buildHtml(p.head, p.lineageRaw, p.stemText, p.launcher, p.blocks) !== html)
      errs.push('拆开再拼回不一致: 文件里有拼装规则之外的内容');
    [['hypha', 认('hypha', p.stemText)]].concat(p.blocks.map(b => {
      const id = b.manifest.id;
      if (ids.has(id)) dup.add(id);
      ids.add(id);
      return [id, 认(id, b.code)];
    })).forEach(([id, q]) => (q ? q.segs : []).forEach(s => {
      if (!s.map) return;
      const at = `${id} 借 ${s.map.block}/${s.map.name}`;
      if (!名[s.map.block]) errs.push(`悬空映射: ${at}, 但文件里没有 ${s.map.block}`);
      else if (!名[s.map.block].has(s.map.name)) errs.push(`悬空映射: ${at}, 但它没有这段或范围`);
      if (!isIdent(s.name)) errs.push(`映射段名不合法: ${id}/${s.name}`);
      if (s.ask && !名[id].has(s.ask.split('.')[0])) errs.push(`按需写错: ${at} · 按需: ${s.ask}, 它没有这段或范围`);
      if (s.lines.slice(1).some(l => l.trim())) errs.push(`映射段只能有那一行, 后面不能跟代码: ${id}/${s.name}`);
    }));
    dup.forEach(d => errs.push('块 id 重复: ' + d));
    const lin = JSON.parse(p.lineageRaw), linIds = (lin.blocks || []).map(x => x.id).sort().join(),
      tagIds = [...ids].sort().join();
    if (linIds !== tagIds) errs.push(`块清单与血统不一致: 血统 [${linIds}] 文件 [${tagIds}]`);
    if (errs.length) fail('门禁未过:\n' + errs.join('\n'));
    return true;
  };
  // 导出: ids 不给 = 启用着的; stem:false = 离体(只带名单上的块借的内核范围)
  const molt = a => {
    const { ids, swap, 带 = {} } = a || {}, solo = a?.stem === false, 号 = {};
    (ids || []).forEach(i => blockOf(i) || fail('无此块: ' + i));
    const sel = L.factory.filter(b => ids ? ids.includes(b.manifest.id) : isEnabled(b)),
      在场 = new Set(solo ? [] : sel.map(b => b.manifest.id)),
      门 = (st, bs, n) => {
        const h = 拼(st, bs, swap, n ? L.head.replace(/<title>[^<]*/, () => '<title>' + n.replace(/[<&]/g, ''))
          : L.head, solo ? '' : L.launcher);
        gates(h, swap, solo);
        return h;
      };
    if (!solo) {
      const st = 换(stemTextNow(), 'hypha', 在场, 带).code;
      return 门(st, exportBlocks(sel, 在场, 带, false, st), !sel.length && 'Hypha');
    }
    const bs = exportBlocks(sel, 在场, 带, true, '', 号), want = new Set();
    bs.forEach(e => parseSegs(e.code).segs.forEach(s => {
      if (s.map && s.map.block === 'hypha') [s.map.name].concat(s.want).forEach(n => want.add(n));
    }));
    if (!want.size) fail('名单里没有内核, 块也没借内核的代码, 这样的文件打开跑不起来。在块里加一行: // ↦ 借 hypha 的 离体运行时');
    const stem = 换(cutCode(stemTextNow(), [...want], 'Hypha', 号.hypha = []), 'hypha', 在场, 带).code;
    syntax(stem, '内核只留 [' + [...want] + '] 剪出来的那份');
    bs.forEach(x => { x.disabled = false; });
    const h = 门(stem, bs, bs.map(b => b.manifest.name || b.manifest.id).join(' + '));
    return a.号 ? { html: h, 号 } : h;
  };
  // 「按需: 段.项」从借用方自己的段值表取: 函数就调用、Promise 就等; 没在跑的当空
  const 问 = async bs => {
    const 带 = {};
    for (const b of bs) for (const s of effectiveOf(b).segs) {
      const id = b.manifest.id, [d, n] = (s.ask || '').split('.');
      if (s.map && s.ask && L.inst[id]) 带[id + '/' + s.name] = await Promise.resolve().then(() => {
        const v = SEG[id + '/' + d];
        if (v == null || !(n in Object(v))) fail(`${id} 没有 ${s.ask}`);
        return typeof v[n] === 'function' ? v[n]() : v[n];
      }).then(x => [].concat(x || []), e => new Error('按需 ' + id + '/' + s.ask + ': ' + e.message));
    }
    return 带;
  };

  // ══════════ 隔离窗 ══════════
  // 宿主和 iframe 跑同一段 peer 代码, 流式因此天然双向。
  // 消息: 请求 {seq,path,args} / 分片 {seq,chunk} / 结束 {seq,done,result|error} / 握手 {hello}
  function peer(chan, post, onCall, onHello) {
    let seq = 0, disposed = false;
    const wait = {}, end = (s, o) => post(Object.assign({ __myc: chan, seq: s, done: true }, o));
    const call = (path, args, onChunk) => new Promise((res, rej) => {
      if (disposed) return rej(new Error('实例已卸载'));
      const s = ++seq;
      wait[s] = { res, rej, onChunk };
      try { post({ __myc: chan, seq: s, path, args: args ?? {}, stream: !!onChunk }); }
      catch (e) { delete wait[s]; rej(e); }
    });
    const recv = async d => {
      if (!d || d.__myc !== chan || disposed) return;
      if (d.hello) return onHello && onHello();
      if (d.path) {
        try {
          let r = await onCall(d.path, d.args);
          if (r && typeof r[Symbol.asyncIterator] === 'function') {
            const it = r[Symbol.asyncIterator]();
            for (; ;) {
              if (disposed) { try { await it.return(); } catch (_) { } return end(d.seq, { error: '实例已卸载, 流已取消' }); }
              const n = await it.next();
              if (n.done) { r = n.value; break; }
              post({ __myc: chan, seq: d.seq, chunk: n.value });
            }
          }
          end(d.seq, { result: r ?? null });
        } catch (e) { try { end(d.seq, { error: e?.message || String(e) }); } catch (_) { } }
        return;
      }
      const w = wait[d.seq];
      if (!w) return;
      if (!d.done) return w.onChunk && w.onChunk(d.chunk);
      delete wait[d.seq];
      if (d.error) w.rej(new Error(d.error)); else w.res(d.result);
    };
    return {
      call, recv, hello: () => post({ __myc: chan, hello: true }),
      dispose: () => {
        disposed = true;
        Object.keys(wait).forEach(s => { wait[s].rej(new Error('实例已卸载')); delete wait[s]; });
      },
    };
  }
  // 窗里那一头: colony.某.某(参数) 就是 call('某.某', 参数)
  function glue(chan, context) {
    const exposed = {}, p = peer(chan, m => parent.postMessage(m, '*'), (path, args) => {
        const f = exposed[path];
        if (!f) throw new Error('孢子未暴露: ' + path);
        return f(args);
      }), call = (path, args, onChunk) => p.call(path, args, onChunk), go = () => p.hello(),
      no = k => typeof k !== 'string' || k === 'then' || k === 'toJSON';
    window.addEventListener('message', e => { if (e.source === parent) p.recv(e.data); });
    window.mycelium = new Proxy({ call, callStream: call, expose: (n, f) => { exposed[n] = f; }, context }, {
      get: (t, ns) => no(ns) || ns in t ? t[ns] : new Proxy({}, {
        get: (_, m) => no(m) || m === 'toString' || m === 'valueOf' ? undefined : (a, c) => call(ns + '.' + m, a, c),
      }),
    });
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', go); else go();
    window.dispatchEvent(new Event('mycelium:ready'));
  }
  const iframeGlue = (chan, context) => `(function(){${peer};(${glue})(${JSON.stringify(chan)},`
    + `${JSON.stringify(context || {}).replace(/</g, '\\u003c')})})();`;
  // 挂载: iframe sandbox, 握手后才算就绪; 权限增量归调用方(宿主不给的, 孢子要不到)
  const mount = async opts => {
    const f = doc().createElement('iframe'), chan = 'c' + Math.random().toString(36).slice(2, 9),
      context = opts.context || {}, attrs = {}, ms = opts.timeout || 8000;
    Object.keys(opts.attrs || {}).forEach(k => { attrs[k.toLowerCase()] = opts.attrs[k]; });
    f.setAttribute('sandbox', [...new Set(['allow-scripts', 'allow-forms', 'allow-modals', 'allow-popups',
      'allow-downloads'].concat(String(attrs.sandbox || '').split(/\s+/)))].filter(Boolean).join(' '));
    Object.keys(attrs).forEach(k => { if (k !== 'sandbox') f.setAttribute(k, String(attrs[k])); });
    f.dataset.mycApp = chan;
    if (context.sporeId) f.dataset.spore = context.sporeId;
    f.style.cssText = opts.hidden ? 'display:none' : 'border:0;width:100%;height:100%';
    let ready = false, done;
    const p = peer(chan, m => { if (f.contentWindow) f.contentWindow.postMessage(m, '*'); },
        (path, args) => Net.call(path, args, { frame: f, context }), () => { ready = true; if (done) done(); }),
      onMsg = e => { if (e.source === f.contentWindow) p.recv(e.data); };
    win().addEventListener('message', onMsg);
    f.myc = { call: p.call, context, destroy: () => {
      win().removeEventListener('message', onMsg); p.dispose(); f.remove();
    } };
    const script = `<${SCR}>${iframeGlue(chan, context)}</${SCR}>`,
      html = String(opts.code);
    f.srcdoc = /^\s*<!doctype|<head[\s>]/i.test(html)
      ? html.replace(/^\s*<!doctype[^>]*>|<head(\s[^>]*)?>/i, m => m + script) : script + html;
    (opts.host || doc().body).appendChild(f);
    await new Promise((res, rej) => {
      done = res;
      E.setTimeout(() => ready || rej(Object.assign(new Error(`孢子未就绪(${ms / 1000}s 内没有握手): 它的脚本可能在注入代码之前就出错了`), { frame: f })), ms);
    });
    return f;
  };
  P('hypha.mount', a => mount(a), '在隔离窗里跑一段 HTML, 握手后返回 iframe',
    { code: 'string', host: 'string?', hidden: 'boolean?', attrs: 'object?', context: 'object?', timeout: 'number?' }, false, 'guarded');
  P('hypha.unmount', a => { 帧Of(a.frame).myc.destroy(); return true; }, '销毁隔离窗', { frame: 'string' }, false, 'guarded');
  P('hypha.frames', () => apps().map(f => ({ frame: f.dataset.mycApp, sporeId: f.dataset.spore || null,
    alive: f.isConnected, context: f.myc?.context || {} })), '活着的隔离窗', {}, false);
  P('hypha.invoke', a => 帧Of(a.frame).myc.call(a.path, a.args), '反向调用孢子暴露的能力',
    { frame: 'string', path: 'string', args: 'object?' }, false, 'guarded');
  const apps = () => doc() ? [...doc().querySelectorAll('iframe[data-myc-app]')] : [];
  const 帧Of = id => apps().find(f => f.dataset.mycApp === id)
    || apps().filter(f => f.dataset.spore === id).pop() || fail(`无此运行帧: ${id}(用 hypha.frames 里的 frame 或 sporeId)`);

  // ══════════ 内核自己的能力 ══════════
  P('hypha.nodules', () => {
    const t = borrowTable();
    return L.factory.map(b => outline(b, t)).concat(L.broken.map(x => ({ id: x.id, error: x.error, broken: true })));
  }, '列块, 含每块的段目录; broken 是解析不了的块', {});
  P('hypha.nodule', a => {
    const id = a.id, hypha = id === 'hypha', b = hypha ? stemBlock() : 块(id), eff = effectiveOf(b),
      o = { id, revision: revOf(id) };
    if (a.segment) {
      const s = eff.segs.find(x => x.name === a.segment) || fail('无此段: ' + a.segment);
      o.segment = { name: s.name, text: s.text, use: hypha ? stemUse() : s.use };
      if (a.factory && s.factoryText !== s.text) o.segment.factory = s.factoryText;
      return o;
    }
    Object.assign(o, outline(b), { need: 谁要(id) }, hypha ? { running: true, use: stemUse(), hasEdit: !!stemEdited() } : {});
    if (a.full) Object.assign(o, { code: joinSegs(eff), factory: hypha ? L.stemFactory : b.code });
    return o;
  }, '读一块: 默认段目录(need 谁要哪个名字), full 取全文, segment 只回那一段(factory: true 同时要原版); id 可为 hypha',
    { id: 'string', full: 'boolean?', segment: 'string?', factory: 'boolean?' });
  P('hypha.catalog', (a, m) => Net.catalog(m.by).filter(c => !a.path || c.path.startsWith(a.path)),
    '能力清单与参数形状(块调时带上它自己名下的); 给 path 只列这个前缀的', { path: 'string?' });
  P('hypha.setNodule', a => setNodule(a),
    '唯一写入口。回 changed / restarted / revision; edited / deleted 是和出厂版比',
    { id: 'string', code: 'string|null?(整块改写; null = 恢复出厂)', enabled: 'boolean?',
      segment: 'object?(segment.edits 同 edits)', edits: 'array?(一次改几段, 全成或全不动)',
      preview: 'boolean?(只回每段的改动, 不写不重启)', expected: 'string?(读到的 revision; 对不上就拒绝)',
      remove: 'boolean?', hidden: 'boolean?', active: 'string?' }, false, 'guarded');
  P('hypha.adopt', a => adopt(a), '导入 Nodule: 未知 id 收养禁用, 已知 id 导入为显性', { text: 'string' }, false, 'guarded');
  P('hypha.build', async a => {
    const 带 = await 问(L.factory), x = a.假如, 原 = x && L.recs[x.id];
    if (x) {
      const rec = clone(原) || { segs: {} };
      rec.segs ||= {};
      applyEdits(块(x.id), rec, x.edits, x.id);
      L.recs[x.id] = rec;
    }
    try { return molt(Object.assign({}, a, { 带: { ...带, ...(a.带 || {}) } })); }
    finally { if (x) 原 ? L.recs[x.id] = 原 : delete L.recs[x.id]; }
  }, '导出: 给一张名单, 返回 HTML, 门禁不过则报错。stem: false = 离体(只带名单上的块借的内核范围)',
    { ids: 'string[]?(不给 = 启用着的块)', stem: 'boolean?',
      swap: 'object?(这一块的这一段在导出件里换成 text, 本机什么都不动)',
      假如: 'object?(当这块已经照 edits 改了再导出, 本机什么都不动)' }, false, 'notice');
  P('hypha.reboot', async () => {
    Object.keys(L.inst).forEach(dispose);
    await assembleAll();
    return { running: Object.keys(L.inst) };
  }, '软重启: 卸全部块再装', {}, false, 'notice');
  P('hypha.lineage', () => ({ id: BOOT.id, lineage: BOOT.lineage, safe: L.safe, solo: BOOT.solo }),
    '本文件的指纹、父指纹、块清单', {});
  P('hypha.snapshots', async () => Sub.snapshots(), '列整库快照', {});
  P('hypha.snapshot', async a => {
    if (a.restore) return Sub.restore(a.name);
    if (a.drop) { await Sub.drop(a.name); return Sub.snapshots(); }
    return Sub.snapshot(a.name);
  }, '整库快照: 给 name 拍一张; restore 回滚(之后要 hypha.reboot 块才重装); drop 删。列快照用 hypha.snapshots',
    { name: 'string?', restore: 'boolean?', drop: 'boolean?' }, false, 'guarded');
  P('hypha.journal', a => Sub.read(a || {}), '事件日志: 谁在什么时候写了什么(审计)',
    { since: 'number?', limit: 'number?' });
  P('hypha.trace', a => Net.trace(a || {}), '能力调用记录: path / by / ms / ok(示波器看这个)',
    { path: 'string?', by: 'string?', limit: 'number?' });
  P('hypha.approve', a => {
    const ok = Net.decide(a.id, a.ok, a.remember);
    if (!ok) fail(`没有待审批的请求 ${a.id}(可能已超时被拒)`);
    return { decided: a.id, ok: !!a.ok };
  }, '批准或拒绝一个 guarded 能力的调用(界面用)', { id: 'string', ok: 'boolean?', remember: 'boolean?' }, false);
  P('hypha.pending', () => [...Net.pending.values()].map(p => p.req), '待审批的 guarded 调用', {});
  P('hypha.autonomy', a => {
    if (a.level) {
      if (!['ask', 'remember', 'auto'].includes(a.level)) fail("autonomy 只能是 ask / remember / auto");
      Net.autonomy = a.level;
      if (a.level === 'ask') Net.remembered.clear();
      Sub.set('settings:net.autonomy', a.level, 'hypha');
    }
    return { autonomy: Net.autonomy, remembered: [...Net.remembered] };
  }, 'agent 自主度: ask 每次问 / remember 记住选择 / auto 不拦(改代码、花钱前想清楚)',
    { level: 'string?' }, false, 'notice');

  // ══════════ 裸壳面板 ══════════
  // 没有桌面块时的兜底: 只走能力网, 保证系统永远可操作(能启用块、改内核、导入导出)
  const PANEL_CSS = `.k-panel{max-width:760px;margin:48px auto;padding:0 20px;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
.k-panel h1{font-size:20px;margin:0 0 4px}.k-sub{color:#8a8a8a;font-size:12px;margin-bottom:24px}
.k-block{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 14px;border:1px solid rgba(255,255,255,.09);border-radius:10px;margin-bottom:10px}
.k-block .nm{font-weight:600}.k-block .meta{color:#8a8a8a;font-size:11px}.k-block .sp{flex:1}
.k-tag{font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(126,231,135,.12);color:#7ee787}
.k-tag.warn{background:rgba(245,166,35,.12);color:#f5a623}.k-tag.err{background:rgba(255,87,87,.12);color:#ff5757}
.k-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#fafafa;border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer}
.k-btn:hover{border-color:#7ee787;color:#7ee787}.k-acts{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
.k-msg{margin-top:14px;font-size:12px;color:#8a8a8a;white-space:pre-wrap}.k-msg.err{color:#ff5757}
.k-banner{background:#3a2a00;color:#ffd60a;padding:8px 14px;font-size:13px}`;
  const 面板 = {
    画(el) {
      el.innerHTML = `<style>${PANEL_CSS}</style><div class="k-panel">
<h1>🧬 Mycelium · 裸壳面板</h1>
<div class="k-sub">没有界面块在跑(或它坏了), 这是内核自带的兜底面板: 只走能力网, 系统永远可操作。</div>
<div class="k-blocks"></div>
<div class="k-acts">
  <button class="k-btn" data-a="import">导入块/文件</button>
  <button class="k-btn" data-a="export">导出整个系统</button>
  <button class="k-btn" data-a="reboot">软重启</button>
</div>
<div class="k-msg"></div></div>`;
      const 话 = (m, err) => { const q = el.querySelector('.k-msg'); q.textContent = m; q.className = 'k-msg' + (err ? ' err' : ''); };
      const 列 = async () => {
        const bs = await Net.call('hypha.nodules', {}, { by: 'panel' });
        el.querySelector('.k-blocks').innerHTML = bs.map(b => `<div class="k-block" data-id="${b.id}">
<span>${b.icon || '▪'}</span><span class="nm">${esc(b.name || b.id)}</span>
<span class="meta">${b.id} v${b.version} · ${b.segs?.length || 0} 段</span>
${b.broken ? '<span class="k-tag err">坏</span>' : b.running ? '<span class="k-tag">跑着</span>'
            : `<span class="k-tag warn">${esc(b.error || '停')}</span>`}
<span class="sp"></span>
${b.broken || b.adopted || b.id === 'hypha' ? '' :
            `<button class="k-btn" data-a="toggle">${b.enabled ? '禁用' : '启用'}</button>`}
<button class="k-btn" data-a="read">读一段</button></div>`).join('') || '<div class="k-sub">一个块都没有</div>';
      };
      el.addEventListener('click', async e => {
        const b = e.target.closest('.k-block'), 钮 = e.target.closest('.k-btn');
        if (!钮) return;
        const a = 钮.dataset.a;
        if (a === 'toggle' && b) {
          const x = (await Net.call('hypha.nodules', {}, { by: 'panel' })).find(y => y.id === b.dataset.id);
          await Net.call('hypha.setNodule', { id: b.dataset.id, enabled: !x.enabled }, { by: 'panel' });
          列();
        }
        if (a === 'read' && b) {
          const n = prompt('读哪段? 留空看目录');
          if (n === null) return;
          const r = n ? await Net.call('hypha.nodule', { id: b.dataset.id, segment: n }, { by: 'panel' })
            : await Net.call('hypha.nodule', { id: b.dataset.id }, { by: 'panel' });
          话(JSON.stringify(r, null, 1).slice(0, 4000));
        }
      });
      el.querySelector('.k-acts').addEventListener('click', async e => {
        const 钮 = e.target.closest('.k-btn'); if (!钮) return;
        try {
          if (钮.dataset.a === 'export') {
            const html = await Net.call('hypha.build', {}, { by: 'panel' });
            const a2 = doc().createElement('a');
            a2.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            a2.download = 'mycelium.html'; a2.click();
            话('导出好了: mycelium.html');
          }
          if (钮.dataset.a === 'import') {
            const i = doc().createElement('input');
            i.type = 'file'; i.accept = '.html,.js,.txt';
            i.onchange = async () => {
              const t = await i.files[0].text();
              话(JSON.stringify(await Net.call('hypha.adopt', { text: t }, { by: 'panel' }), null, 1));
              列();
            };
            i.click();
          }
          if (钮.dataset.a === 'reboot') { await Net.call('hypha.reboot', {}, { by: 'panel' }); 话('重启好了'); }
        } catch (err) { 话(err.message, true); }
      });
      列();
      on('mycelium:blocks', 列);
      return () => { };
    },
  };
  P('hypha.panel', a => {
    const host = a?.host?.appendChild ? a.host : doc().createElement('div');   // 同页调用可以直接给元素
    if (!a?.host?.appendChild) (doc().getElementById('mycelium-root') || doc().body).appendChild(host);
    面板.画(host);
    return true;
  }, '把裸壳面板画进 host(桌面块的设置窗用它; 不给就画在页面根部)', { host: {} }, false);

  // ══════════ 启动 ══════════
  const BOOT = { id: 'dev', lineage: null, solo: false, key: 'mycelium.dev' };
  const banner = text => {
    const d = doc();
    if (d?.body) d.body.prepend(Object.assign(d.createElement('div'), { className: 'k-banner', textContent: text }));
  };
  const boot = async env => {
    E = env;
    Object.assign(BOOT, env.boot || {});
    try {
      await Sub.open('mycelium@' + BOOT.id);
      if (Sub.warn) banner(`存储打不开(${Sub.warn}), 这次的改动不会保存`);
      if (doc()) {
        L.head = doc().head.outerHTML.replace(/<style\b[^>]*>[\s\S]*?<\/style>\s*/gi,
          m => m.includes('裸壳页自用样式') ? m : '');
        L.launcher = (doc().getElementById('hypha-launcher') || {}).textContent || '';
        L.stemFactory = (doc().getElementById('hypha') || {}).textContent || '';
      }
      // 跑在别的 Mycelium 的隔离窗里: 本机没有的能力问外面那座桥
      try {
        const p = win()?.parent;
        if (p && p !== win() && p.mycelium?.expose) Net.外 = p.mycelium;
      } catch (_) { }
      if (BOOT.safe) banner('安全模式: 已忽略全部改版与收养, 跑的是原版内核(?safe=1)');
      const a = await Sub.get('settings:net.autonomy');
      if (a) Net.autonomy = a;
      await assembleAll();
      if (Net.外) Net.外.expose('call', a2 => Net.call(a2.path, a2.args));
      try { LS()?.setItem(BOOT.key + '.crash', '0'); } catch (_) { }
      if (doc() && !env.boot.headless && !Net.has('ui.host')) {   // 没有界面块: 内核兜底面板, 系统永远可操作
        const host = doc().getElementById('mycelium-root') || doc().body;
        面板.画(host);
      }
    } catch (e) { banner('启动失败: ' + e.message); throw e; }
  };
  const reboot = async () => {
    Object.keys(L.inst).forEach(dispose);
    await assembleAll();
    return { running: Object.keys(L.inst) };
  };

  // ══════════ 离体运行时 ══════════
  // 块加一行 // ↦ 借 hypha 的 离体运行时, 就能被导出成独立文件(孢子导出)。
  // 离体文件里只有这一运行时: 内存 kv + 最小能力网 + 段值表 + 自启动。
  // 块的代码因此要能在两种环境下都跑: 整系统里用完整内核, 离体时用这一份 ——
  // 要存东西的只在内存里, 要调别的块的能力会收到清楚的错(它不在)。
  // ✂ 离体运行时
  const 离体运行时 = (() => {
    const mem = new Map(), 拷 = x => x == null ? x : JSON.parse(JSON.stringify(x));
    const kv = {
      get: async k => mem.has(k) ? 拷(mem.get(k)) : null,
      set: async (k, v) => { mem.set(k, 拷(v)); },
      del: async k => { mem.delete(k); },
      list: async p => [...mem].filter(([k]) => !p || k.startsWith(p)).map(([key, value]) => ({ key, value: 拷(value) })),
    };
    const CAP = {};
    const net = {
      provide: (path, fn, meta = {}, by = '离体') => { CAP[path] = { fn, by }; },
      call: (path, args) => new Promise((res, rej) => {
        const c = CAP[path];
        if (!c) return rej(new Error(`离体文件里没有能力 ${path}: 它要整系统里的别的块, 把那份 Mycelium 也带上`));
        Promise.resolve().then(() => c.fn(args || {}, {})).then(res, rej);
      }),
      has: path => !!CAP[path],
      catalog: () => Object.keys(CAP).sort().map(p => ({ path: p, by: CAP[p].by })),
    };
    const SEG2 = {};
    const segRef = key => new Proxy(function () { }, {
      get: (_, p) => (typeof p === 'string' && p !== 'then') ? SEG2[key]?.[p] : undefined,
      apply: (_, t, a) => SEG2[key]?.apply(t, a),
      construct: (_, a) => Reflect.construct(SEG2[key], a),
    });
    const ctxFor = id => {
      const cleanups = [];
      const ctx = { id, root: null, kv, provide: net.provide, call: net.call, has: net.has,
        on: () => () => { }, cleanup: fn => cleanups.push(fn), trace: () => { },
        log: (...a) => console.log('[' + id + ']', ...a) };
      return { ctx, cleanups, colony: { call: ctx.call, has: ctx.has, get solo() { return true; } } };
    };
    const 析 = text => {
      const m = /\/\*NODULE\*\/([\s\S]*?)\/\*CODE\*\//.exec(text)
        || /^\/\/ @nodule (\{[\s\S]*?\})\s*\n/.exec(text);
      if (!m) throw new Error('块缺少 /*NODULE*/ 清单头');
      const manifest = JSON.parse(m[1].trim());
      const code = m[0].startsWith('/*NODULE*/') ? text.slice(m.index + m[0].length) : text.slice(m[0].length);
      return { manifest, code: String(code).replace(/^\s*\n/, '').replace(/\s+$/, '') };
    };
    let 启过 = false;
    const boot = () => {
      if (启过 || typeof document === 'undefined') return;
      if (typeof window !== 'undefined' && window.mycelium && window.mycelium.net) return;   // 整系统在跑, 不抢
      启过 = true;
      document.querySelectorAll('script[type="mycelium/nodule"]').forEach(el => {
        try {
          const b = 析(el.textContent), o = ctxFor(b.manifest.id), 段 = {
            set: (n, get) => Object.defineProperty(SEG2, b.manifest.id + '/' + n, { get, configurable: true }),
            ref: k => segRef(k), clear: () => { },
          };
          new Function('ctx', '__seg', 'colony', b.code)(o.ctx, 段, o.colony);
        } catch (e) { console.error('[离体]', b0(el), e); }
      });
      function b0(el) { return el.getAttribute('data-id') || '?'; }
    };
    if (typeof document !== 'undefined') {
      // 等当前这批脚本执行完再判断: 整系统的内核那时已经设好 window.mycelium, 这里就不抢了
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else setTimeout(boot, 0);
    }
    return { kv, net, SEG: SEG2, segRef, ctxFor, boot };
  })();
  // 整系统里也登记: 块离体导出后, 这一行还在, 指着同一份运行时
  if (typeof SEG !== 'undefined') SEG['hypha/离体运行时'] = 离体运行时;
  // ✂ 离体运行时 完

  // ══════════ 对外 ══════════
  g.mycelium = {
    boot, reboot,
    get env() { return E; },
    net: Net, sub: Sub,
    // 测试与调试用: 内核机制不藏
    internals: { parseSegs, joinSegs, lay, pick, cutCode, copyOf, effective, mark, headLine, segKey, 换, 连,
      checkShape, 正化 },
  };
  // 单独打开的文件(离体)也有全局入口
  if (typeof window !== 'undefined') {
    window.mycelium = g.mycelium;
    window.myc = { call: (p, a) => Net.call(p, a, { by: 'window' }), has: p => Net.has(p) };
  }
})(typeof window !== 'undefined' ? window : globalThis);
