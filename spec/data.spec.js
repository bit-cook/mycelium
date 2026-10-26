/* 次元口袋: 数据读写 + 归属守卫(谁的前缀谁管) */
import assert from 'node:assert/strict';
import { harness } from '../tools/harness.js';

export default async () => {
  const h = await harness();
  await h.load('blocks/ai.js');        // 自报认领 settings:ai.
  await h.load('blocks/agent.js');     // 自报认领 agent.会话 等
  await h.load('blocks/pocket.js');

  // ── 基本读写 ──
  await h.call('data.set', { key: 'media:笔记1', value: { 文: '你好' } });
  const 读 = await h.call('data.get', { key: 'media:笔记1' });
  assert.equal(读.value.文, '你好');
  assert.equal((await h.call('data.list', { prefix: 'media:' })).length, 1);

  // ── 归属: 各块自报的前缀, 最长的算数 ──
  const 归 = await h.call('data.own', { key: 'settings:ai.providers' });
  assert.equal(归.归属, 'AI 配置');
  assert.equal(归.edit, 'ai.configure', '改它该走 ai.configure');
  const 我 = await h.call('data.own', { key: 'media:没人认领的' });
  assert.equal(我.归属, '次元口袋', 'media: 归口袋自己');

  // ── 守卫: agent 经口袋写 ai 的前缀 → 挡, 并指路 ──
  await assert.rejects(() => h.call('data.set', { key: 'settings:ai.providers', value: [], by: 'agent' }),
    /归AI 配置管, 改它走 ai\.configure/);
  // 口袋自己的前缀(自报里没写 edit 的): 谁都能经口袋写
  await h.call('data.set', { key: 'media:口袋自己', value: [1] });
  assert.deepEqual([...(await h.call('data.get', { key: 'media:口袋自己' })).value], [1]);
  // 硬删归人的数据: 要 force(想清楚)
  await assert.rejects(() => h.call('data.clean', { key: 'settings:ai.providers' }), /要硬删给 force/);
  await h.call('data.clean', { key: 'settings:ai.providers', force: true });

  // ── 块记录是内核的地盘: 谁都不能经口袋写(归属表先说, kv 层再拦) ──
  await assert.rejects(() => h.call('data.set', { key: 'block:ai', value: {} }),
    /归Hypha管, 改它走 hypha\.setNodule|块记录只能经 hypha\.setNodule 改/);

  // ── 删: 人在口袋里删不拦(by 是口袋自己时) ──
  await h.call('data.del', { key: 'media:笔记1', by: 'pocket' });
  await assert.rejects(() => h.call('data.get', { key: 'media:笔记1' }), /没有这个键/);

  // ── journal: 每次写留痕(谁、什么时候、写了什么) ──
  const 志 = await h.call('hypha.journal', { limit: 50 });
  assert.ok(志.some(e => e.op === 'set' && e.key === 'media:笔记1'));
  assert.ok(志.every(e => e.t > 0 && e.at !== undefined || e.t > 0));
};
