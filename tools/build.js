/* 构建: 多文件开发态 → 单文件发布态。
   块文件以 // @nodule {清单} 开头, 本身就是合法 JS(node --check 得过);
   打包时换成规范形式(NODULE 清单 + CODE 头 + 函数体), 一个字节都不改内容 ——
   开发态跑的文件和发布态跑的文件逐字节一致, 这才是"单文件"的意义。 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 根 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 读 = f => readFileSync(join(根, f), 'utf8');
const hash = s => {                       // 与内核一致的双 hash
  s = String(s ?? '');
  let a = 5381, b = 2166136261;
  for (let i = 0, c; i < s.length; i++) {
    c = s.charCodeAt(i);
    a = ((a << 5) + a + c) >>> 0;
    b = Math.imul(b ^ c, 16777619) >>> 0;
  }
  return [a, b].map(n => n.toString(16).padStart(8, '0')).join('');
};

export function build({ out = 'mycelium.html', only } = {}) {
  const hypha = 读('src/hypha.js'), launcher = 读('src/launcher.js'), shell = 读('src/shell.html');
  const dir = join(根, 'blocks');
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.js')).sort() : [];
  const blocks = files
    .filter(f => !only || only.includes(f.replace(/\.js$/, '')))
    .map(f => {
      const text = 读('blocks/' + f);
      const m = /^\/\/ @nodule (\{[\s\S]*?\})\s*\n/.exec(text);
      if (!m) throw new Error(`blocks/${f} 缺少 // @nodule 清单头`);
      const manifest = JSON.parse(m[1].trim());
      if (/<\/script/i.test(text)) throw new Error(`blocks/${f} 含字面 </script>, 块住在 script 里, 不能有关闭串`);
      return { file: f, manifest, code: text.slice(m[0].length).replace(/^\s*\n/, '').replace(/\s+$/, '') };
    });
  const seen = new Set();
  blocks.forEach(b => {
    if (seen.has(b.manifest.id)) throw new Error(`块 id 重复: ${b.manifest.id}(${b.file})`);
    seen.add(b.manifest.id);
  });
  const noduleTags = blocks.map(b =>
    `<script type="mycelium/nodule" data-id="${b.manifest.id}">\n/*NODULE*/${JSON.stringify(b.manifest)}/*CODE*/\n${b.code}\n</script>`).join('\n');
  const body = raw => shell
    .replace('__LINEAGE__', raw)
    .replace('__HYPHA__', () => hypha)
    .replace('__LAUNCHER__', () => launcher)
    .replace('__NODULES__', () => noduleTags);
  const lin = { id: hash(body('')), parent: '', at: new Date().toISOString(),
    blocks: blocks.map(b => ({ id: b.manifest.id, version: b.manifest.version || 0 })) };
  const html = body(JSON.stringify(lin));
  const 出路 = join(根, out);
  writeFileSync(出路, html);
  return { out: 出路, bytes: Buffer.byteLength(html), id: lin.id,
    blocks: blocks.map(b => `${b.manifest.id} v${b.manifest.version || 0}`) };
}

if (process.argv[1] && process.argv[1].endsWith('build.js')) {
  const r = build();
  console.log(`✓ ${r.out}  ${(r.bytes / 1024).toFixed(1)} KB  血统 ${r.id}`);
  r.blocks.forEach(b => console.log('  · ' + b));
}
