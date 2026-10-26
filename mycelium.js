#!/usr/bin/env node
/* mycelium CLI: build(打包单文件) / test(跑测试) / serve(开发服务器) */
import { build } from './tools/build.js';
import { runSpecs } from './tools/harness.js';

const 命令 = process.argv[2];
if (命令 === 'build') {
  const r = build();
  console.log(`✓ ${r.out}  ${(r.bytes / 1024).toFixed(1)} KB  血统 ${r.id}`);
  r.blocks.forEach(b => console.log('  · ' + b));
} else if (命令 === 'test') {
  const 败 = await runSpecs();
  const { 冒烟 } = await import('./tools/smoke.js');
  const r = await 冒烟();
  console.log(`✓ smoke(单文件完整装载)  块 ${r.跑.length}/${r.块.length} 在跑, 能力 ${r.能力}, 导出 ${r.导出字节} 字节`);
  if (r.坏.length) console.log('  坏块:', r.坏.join('; '));
  process.exit(败 ? 1 : 0);
} else if (命令 === 'smoke') {
  const r = await (await import('./tools/smoke.js')).冒烟();
  console.log('✓ 冒烟通过  块:', r.跑.join(', '), '| 能力:', r.能力);
  process.exit(0);
} else if (命令 === 'serve') {
  const { createServer } = await import('node:http');
  const { readFileSync, existsSync } = await import('node:fs');
  const { join, extname } = await import('node:path');
  const 型 = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  createServer((q, s) => {
    const 路 = join(process.cwd(), decodeURIComponent(q.url.split('?')[0]));
    const 文 = existsSync(路) && !路.endsWith('/') ? 路 : join(process.cwd(), 'mycelium.html');
    try {
      s.writeHead(200, { 'Content-Type': (型[extname(文)] || 'text/plain') + ';charset=utf-8' });
      s.end(readFileSync(文));
    } catch (e) { s.writeHead(404); s.end('没有这个文件: ' + 路); }
  }).listen(8686, () => console.log('✓ http://localhost:8686  (先 node mycelium.js build 生成 mycelium.html)'));
} else {
  console.log('用法: node mycelium.js <build|test|serve>');
}
