/* 桌面布局回归测试: 块的界面必须被桌面收编进容器, 不能被 #desk 盖住。
   (2026-10-26 线上事故: #desk 是 position:fixed;inset:0 的全屏层, DOM 里排在块的界面之后,
    把 agent 对话栏全盖住 → 点不进、输不入。此测试用迷你 DOM 跑真布局, 挡住回归。) */
import assert from 'node:assert/strict';
import { harness } from '../tools/harness.js';
import { 小文档 } from '../tools/minidom.js';

const 等 = ms => new Promise(r => setTimeout(r, ms));
const 没收的 = doc => doc.querySelectorAll('#mycelium-root > [data-nodule-id]')
  .filter(el => el.dataset.noduleId !== 'desktop');      // 桌面块自己的根是空的(它画在 body 上)

export default async () => {
  // ── 真实流程: 空根开机(内核画兜底面板) → 装四个块 → 桌面收编 ──
  const { doc } = 小文档([]);
  const h = await harness({ doc, headless: false });
  // 没有界面块时内核画兜底面板: 系统永远可操作
  assert.ok(doc.querySelector('[data-k-panel]'), '没有界面块时内核兜底面板顶上');
  for (const b of ['ai', 'agent', 'desktop', 'pocket']) await h.load(`blocks/${b}.js`);
  await 等(120);                       // 收编异步(查 hypha.nodules 取名); 各块挂界面也异步

  // ── 1. 兜底面板撤了(不然盖住块的界面) ──
  assert.equal(doc.querySelectorAll('[data-k-panel]').length, 0, '界面块回来后兜底面板撤掉');

  // ── 2. 桌面三件套 ──
  assert.ok(doc.getElementById('desk'), '#desk 画了');
  assert.ok(doc.getElementById('dock'), '#dock 画了');
  assert.ok(doc.getElementById('agent-dock'), '#agent-dock 画了');

  // ── 3. 关键不变量: 没有块的界面还光着挂在 #mycelium-root 下(那就会被 #desk 盖住) ──
  assert.equal(没收的(doc).length, 0, '块的界面都被收编了(漏一个就会被全屏 #desk 盖住点不到)');

  // ── 4. agent 的界面在 #agent-dock 里, 且对话栏默认开着 ──
  const agent根 = doc.querySelector('[data-nodule-id="agent"]');
  assert.ok(agent根, 'agent 的界面根还在文档里');
  assert.ok(agent根.closest('#agent-dock'), 'agent 界面收进了 #agent-dock(不是被盖住)');
  assert.ok(doc.getElementById('agent-dock').classList.contains('in'), '对话栏默认展开');
  assert.ok(agent根.querySelector('.ag'), 'agent 的对话栏(输入框那套)挂进去了');

  // ── 5. ai / pocket 的界面在窗口里, 窗口挂在 #desk 上(层叠正确) ──
  for (const id of ['ai', 'pocket']) {
    const 根 = doc.querySelector(`[data-nodule-id="${id}"]`);
    assert.ok(根, id + ' 的界面根还在');
    const 窗 = 根.closest('.u-win');
    assert.ok(窗, id + ' 界面收进了窗口');
    assert.ok(窗.closest('#desk'), id + ' 的窗口是 #desk 的子节点(桌面层之内, 不被盖)');
  }

  // ── 6. 任务栏: 内置窗按钮 + agent 开关都在 ──
  const 坞 = doc.getElementById('dock');
  assert.ok(坞.querySelectorAll('button').length >= 5, '任务栏按钮齐(设置/口袋/示波器/模型/agent)');

  // ── 7. 块后装/被替换也会被收编(监听 mycelium:blocks 自愈) ──
  const { doc: doc2 } = 小文档([]);
  const h2 = await harness({ doc: doc2, headless: false });
  await h2.load('blocks/desktop.js');
  await 等(80);
  assert.equal(没收的(doc2).length, 0);
  const 新根 = doc2.createElement('div');
  新根.setAttribute('data-nodule-id', 'pocket');
  doc2.getElementById('mycelium-root').appendChild(新根);
  doc2.dispatchEvent({ type: 'mycelium:blocks', detail: {} });   // 内核改块后发的事件
  await 等(80);
  assert.equal(没收的(doc2).length, 0, '后装的块也被收编');
  assert.ok(新根.closest('.u-win'), '后装的块进了窗口');
};
