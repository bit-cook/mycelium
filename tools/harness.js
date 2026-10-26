/* 测试harness: 把内核跑在 node 里 —— 内存基质 + 假 DOM + 桩能力 + 可审批 + 可导出。
   块因此可以在没有浏览器的情况下测: 装载、借用、改块、导出、审批全链路。
   用法:
     const h = await harness()
     h.stub('ai.chat', async () => ({ content: '你好' }))
     await h.load('blocks/agent.js')
     const r = await h.call('agent.send', { text: '在吗' })
     assert.equal(r.queued, false) */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 内核源码 = readFileSync(join(根, 'src/hypha.js'), 'utf8');
const 启动器源码 = readFileSync(join(根, 'src/launcher.js'), 'utf8');

// 假 DOM: 内核只用得到 querySelectorAll(找块标签)/ getElementById / createElement / dispatchEvent
const 假文档 = () => {
  const 听 = new Map(), 块 = [], 按id = new Map();
  const 发 = e => (听.get(e.type) || []).forEach(fn => fn(e));
  return {
    块, 按id,
    addEventListener: (t, fn) => 听.set(t, [...(听.get(t) || []), fn]),
    removeEventListener: (t, fn) => 听.set(t, (听.get(t) || []).filter(x => x !== fn)),
    dispatchEvent: e => { 发(e); return true; },
    querySelectorAll: s => s.includes('mycelium/nodule') ? 块.slice() : [],
    querySelector: () => null,
    getElementById: id => 按id.get(id) || null,
    createElement: () => ({ style: {}, dataset: {}, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild() { }, remove() { } }),
    head: { outerHTML: '<head><meta charset="UTF-8"><title>harness</title></head>' },
    body: { prepend() { }, appendChild() { } },
  };
};

export async function harness({ autonomy = 'auto', headless = true } = {}) {
  const doc = 假文档();
  // 导出(hypha.build)要从"文件"里取内核文本和启动器: harness 里喂真的
  doc.按id.set('hypha', { textContent: 内核源码 });
  doc.按id.set('hypha-launcher', { textContent: 启动器源码 });
  const env = {
    doc, win: { addEventListener() { }, removeEventListener() { } },
    ls: null, idb: null,                       // 无 localStorage / 无 IndexedDB → 全内存
    fetch: async url => { throw new Error(`harness 里没有网络(${url}), 用 h.env.fetch = fn 桩掉`); },
    setTimeout, clearTimeout,
    boot: { id: 'test', lineage: null, solo: false, safe: false, key: 'mycelium.test', headless },
  };
  const 沙箱 = {
    console, CustomEvent, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto,
    AbortController, setTimeout, clearTimeout, btoa, atob,
    fetch: (...a) => env.fetch(...a),           // 块里裸调的 fetch 走 env, 测试可换
  };
  沙箱.globalThis = 沙箱;
  vm.createContext(沙箱);
  vm.runInContext(内核源码, 沙箱, { filename: 'hypha.js' });
  await 沙箱.mycelium.boot(env);
  const net = 沙箱.mycelium.net;

  const h = {
    kernel: 沙箱.mycelium, net, sub: 沙箱.mycelium.sub, doc, env,
    events: [],                                  // 收到的事件(notice / blocks)
    approvals: [],                               // guarded 调用进来的审批请求
    stubs: new Map(),                            // path → {fn, meta}: reboot 后重放, 免得和块重新登记撞名
    // 装一个块文件(blocks/xxx.js), 装完 reboot 让全系统看见它
    async load(file, { disabled = false } = {}) {
      const text = readFileSync(join(根, file), 'utf8');
      const m = /^\/\/ @nodule (\{[\s\S]*?\})/.exec(text) || {};
      const id = JSON.parse(m[1] || '{}').id || file;
      doc.块.push({ textContent: text, getAttribute: k => k === 'data-id' ? id
        : k === 'data-disabled' ? (disabled ? '1' : null) : null });
      return h.reboot();
    },
    // 桩一个能力: 直接顶掉 CAP 里同名的(测试替身的正业), 回取消函数
    stub(path, fn, meta = {}) {
      h.stubs.set(path, { fn, meta });
      net.CAP[path] = { fn, by: 'stub', desc: meta.desc || '', schema: meta.schema || null,
        level: meta.level || 'open', frames: meta.frames !== false,
        common: meta.common === true || undefined };
      return () => { h.stubs.delete(path); delete net.CAP[path]; };
    },
    call: (path, args) => net.call(path, args, { by: 'test' }),
    async setNodule(a) { return h.call('hypha.setNodule', a); },
    async read(id, segment) { return h.call('hypha.nodule', segment ? { id, segment } : { id }); },
    async build(a) { return h.call('hypha.build', a); },
    async reboot() {
      h.stubs.forEach((_, path) => delete net.CAP[path]);   // 先撤桩, 让块重新登记不撞名
      const r = await 沙箱.mycelium.reboot();
      h.stubs.forEach(({ fn, meta }, path) => {             // 块登记完, 桩再顶回去
        net.CAP[path] = { fn, by: 'stub', desc: meta.desc || '', schema: meta.schema || null,
          level: meta.level || 'open', frames: meta.frames !== false,
          common: meta.common === true || undefined };
      });
      return r;
    },
    async setAutonomy(level) { return h.call('hypha.autonomy', { level }); },
    async approveAll(ok = true, remember = true) {
      const out = [];
      for (const r of h.approvals.splice(0)) {
        out.push(await h.call('hypha.approve', { id: r.id, ok, remember }));
      }
      return out;
    },
    caps: () => net.catalog('test').map(c => c.path),
    errors: () => Object.keys(沙箱.mycelium.net).length && 沙箱.mycelium.sub && null,
  };
  // 收事件与审批请求
  doc.addEventListener('mycelium:notice', e => h.events.push({ type: 'notice', ...e.detail }));
  doc.addEventListener('mycelium:approve', e => h.approvals.push(e.detail));
  doc.addEventListener('mycelium:blocks', () => h.events.push({ type: 'blocks' }));
  await h.setAutonomy(autonomy);
  return h;
}

/* 极简 runner: 不用 node:test, 保持零依赖。
   spec 目录里每个 *.spec.js 默认导出一个 async 函数, 里面用 assert。 */
export async function runSpecs(dir = 'spec') {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(根, dir)).filter(f => f.endsWith('.spec.js')).sort();
  let 过 = 0, 败 = 0;
  for (const f of files) {
    const mod = await import(join(根, dir, f));
    const 跑 = mod.default;
    if (typeof 跑 !== 'function') { console.log(`· ${f} 没有默认导出, 跳过`); continue; }
    try { await 跑(); console.log(`✓ ${f}`); 过++; }
    catch (e) { console.log(`✗ ${f}\n  ${e?.message || e}`); if (e?.stack) console.log(e.stack.split('\n').slice(1, 4).map(l => '  ' + l.trim()).join('\n')); 败++; }
  }
  console.log(`\n${过} 过, ${败} 败`);
  return 败;
}
