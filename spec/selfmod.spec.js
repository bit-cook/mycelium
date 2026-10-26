/* 自修改闭环: 系统的招牌能力 —— 照规矩改一块的代码, 改完行为真的变了, 还能恢复出厂。
   这就是 agent 在 Mycelium 里干活的完整回路: 读段目录 → 读那段 → preview → replace → 验证 → 不对就改回去。 */
import assert from 'node:assert/strict';
import { harness } from '../tools/harness.js';

export default async () => {
  const h = await harness();
  await h.load('spec/fixtures/zz-source.js');

  // 1. 先看这块能干什么、代码长什么样(目录 + 段原文)
  const 目录 = await h.read('zz-source');
  assert.ok(目录.segs.some(s => s.name === '值'), '段目录里有「值」段');
  assert.equal(目录.about.desc.length > 0, true, '自报有描述');
  const 段 = await h.read('zz-source', '值');
  assert.match(段.segment.text, /const 值 = \{ 来自: '甲' \};/);

  // 2. 行为前
  assert.deepEqual({ ...await h.call('src.值') }, { 来自: '甲' });

  // 3. preview: 只看不改
  const 预 = await h.setNodule({ id: 'zz-source', preview: true,
    edits: [{ name: '值', replace: [{ old: "来自: '甲'", new: "来自: '甲(改过的)'" }] }] });
  assert.equal(预.preview, true);
  assert.equal(预.changed, true);
  assert.deepEqual({ ...await h.call('src.值') }, { 来自: '甲' }, 'preview 不动行为');

  // 4. 真改: 只换对上的那一处
  const 写 = await h.setNodule({ id: 'zz-source',
    edits: [{ name: '值', replace: [{ old: "来自: '甲'", new: "来自: '甲(改过的)'" }] }] });
  assert.equal(写.changed, true);
  assert.equal(写.restarted, true);
  assert.ok(写.edited.includes('值'));

  // 5. 行为真的变了(语法过了不算数, 要真调一次)
  assert.deepEqual({ ...await h.call('src.值') }, { 来自: '甲(改过的)' });

  // 6. 改坏了: 不落库, 正在跑的那份不动
  await assert.rejects(() => h.setNodule({ id: 'zz-source',
    edits: [{ name: '值', text: '// ═ 值 ═\nconst 值 = { 来自: ;' }] }), /语法错误/);
  assert.deepEqual({ ...await h.call('src.值') }, { 来自: '甲(改过的)' }, '语法错就不换');

  // 7. 不对就改回去: 恢复出厂
  await h.setNodule({ id: 'zz-source', code: null });
  assert.deepEqual({ ...await h.call('src.值') }, { 来自: '甲' });

  // 8. 全程留痕: journal 记了谁在什么时候写了什么
  const 志 = await h.call('hypha.journal', { limit: 100 });
  assert.ok(志.some(e => e.op === 'set' && e.key === 'block:zz-source'), '改块记进了日志');

  // 9. 改过的块照样能整系统导出(改版跟着走)
  await h.setNodule({ id: 'zz-source',
    edits: [{ name: '值', replace: [{ old: "来自: '甲'", new: "来自: '导出见'" }] }] });
  const html = await h.build({});
  assert.match(html, /来自: '导出见'/, '导出的带着改版');
};
