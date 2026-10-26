/* 上线验证: 拉取官网页面, 核对关键交互元素齐全 */
import { readFileSync } from 'node:fs';
const h = readFileSync('/tmp/live2.html', 'utf8');
const 查 = {
  '标题正确': h.includes('<title>Mycelium 菌丝体 — 一个文件就能跑的个人 AI 操作系统</title>'),
  '演示 iframe 指向真身': h.includes('<iframe class="demo-frame" src="mycelium.html"'),
  '段解析器 playground': h.includes('id="pg-in"'),
  '菌丝 canvas 背景': h.includes('id="net"'),
  '滚动显现(IO)': h.includes('IntersectionObserver'),
  'GitHub 仓库链接': h.includes('https://github.com/bit-cook/mycelium'),
  'Colony 致敬链接': h.includes('520xiaomumu/colony'),
  '对照表章节': h.includes('id="vs"'),
  '路线图章节': h.includes('id="road"'),
  '测试章节': h.includes('id="tests"'),
  '演示章节': h.includes('id="demo"'),
  'tabs 数量=6': (h.match(/class="tab[ "]/g) || []).length === 6,
  '测试卡片=6': (h.match(/class="test"/g) || []).length === 6,
  '内联 script': h.includes('function 高亮'),
};
let 败 = 0;
for (const [k, v] of Object.entries(查)) { if (!v) 败++; console.log(v ? '✓' : '✗', k); }
console.log(败 ? `\n${败} 项缺失` : '\n全部通过 — 官网完整上线');
process.exit(败 ? 1 : 0);
