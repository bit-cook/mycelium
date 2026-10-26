/* 冒烟测试: 在 node 里模拟浏览器完整加载 mycelium.html(内核 → 启动器 → 块标签),
   验证"双击就能跑"不只是语法正确, 而是装载、能力登记、导出都真的通。
   假 DOM 只实现内核与启动器用到的部分; 块的界面代码在真实浏览器里跑(这里会记日志不致命)。 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 根 = join(dirname(fileURLToPath(import.meta.url)), '..');

export function 冒烟(file = 'mycelium.html') {
  return new Promise((res, rej) => {
    const html = readFileSync(join(根, file), 'utf8');
    const 内核 = /<script id="hypha">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const 启动器 = /<script id="hypha-launcher">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const 块们 = [...html.matchAll(/<script type="mycelium\/nodule" data-id="([^"]+)">([\s\S]*?)<\/script>/g)];
    if (!内核 || !启动器 || !块们.length) return rej(new Error('文件结构不完整: 内核/启动器/块标签缺一'));
    const 听 = new Map();
    const 块标签 = 块们.map(m => ({ textContent: m[2], getAttribute: k => k === 'data-id' ? m[1] : null }));
    const doc = {
      readyState: 'loading',
      addEventListener: (t, fn) => 听.set(t, [...(听.get(t) || []), fn]),
      removeEventListener: () => { },
      dispatchEvent: e => { (听.get(e.type) || []).forEach(f => f(e)); return true; },
      querySelectorAll: s => s.includes('mycelium/nodule') ? 块标签 : [],
      getElementById: id => ({ hypha: { textContent: 内核 }, 'hypha-launcher': { textContent: 启动器 } })[id] || null,
      createElement: () => ({ style: {}, dataset: {}, attrs: {}, setAttribute() { }, appendChild() { }, remove() { } }),
      head: { outerHTML: '<head><meta charset="UTF-8"><title>Mycelium</title></head>' },
      body: { prepend() { }, appendChild() { } },
      documentElement: { outerHTML: html },
    };
    const sandbox = {
      console, CustomEvent, TextEncoder, TextDecoder, structuredClone, AbortController,
      crypto: webcrypto, btoa, atob, setTimeout, clearTimeout,
      document: doc, localStorage: null, indexedDB: null,
      fetch: async () => { throw new Error('冒烟测试没有网络'); },
      location: { search: '' },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    try {
      vm.runInContext(内核, sandbox, { filename: 'hypha.js' });
      vm.runInContext(启动器, sandbox, { filename: 'launcher.js' });
    } catch (e) { return rej(new Error('内核或启动器执行失败: ' + e.message)); }
    setTimeout(async () => {
      const M = sandbox.mycelium;
      if (!M) return rej(new Error('启动器没把 mycelium 挂上'));
      try {
        const ns = await M.net.call('hypha.nodules', {}, { by: '冒烟' });
        const 跑 = ns.filter(b => b.running).map(b => b.id);
        const 坏 = ns.filter(b => b.broken);
        const 目录 = M.net.catalog('冒烟');
        const 导出 = await M.net.call('hypha.build', {}, { by: '冒烟' });
        res({
          块: ns.map(b => b.id), 跑, 坏: 坏.map(b => b.id + ': ' + b.error),
          能力: 目录.length, 导出字节: 导出.length,
          审批待办: M.net.pending.size,
        });
      } catch (e) { rej(e); }
    }, 400);
  });
}

if (process.argv[1] && process.argv[1].endsWith('smoke.js')) {
  冒烟().then(r => {
    console.log('✓ 冒烟通过');
    console.log('  装载:', r.块.join(', '));
    console.log('  在跑:', r.跑.join(', '));
    console.log('  坏块:', r.坏.join('; ') || '无');
    console.log('  能力数:', r.能力, '| 导出字节:', r.导出字节);
    process.exit(0);
  }).catch(e => { console.log('✗ 冒烟失败:', e.message); process.exit(1); });
}
