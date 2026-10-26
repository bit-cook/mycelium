/* 全能 agent: 工具循环 / 重试 / 压缩接力 / 系统提示可读可改 / 引用 */
import assert from 'node:assert/strict';
import { harness } from '../tools/harness.js';

export default async () => {
  // ── 工具循环: 模型要工具就执行、结果回灌、再请求, 直到不再要工具 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/agent.js');
    let 轮 = 0, 见过工具表 = null;
    h.stub('ai.chat', async ({ messages, tools }) => {
      轮++;
      见过工具表 = tools;
      if (轮 === 1) return { content: '我先看看', toolCalls: [{ id: 't1', name: 'ui__state', args: {} }] };
      return { content: '看完了: 桌面上有一个时钟', toolCalls: null };
    });
    h.stub('ui.state', async () => ({ 桌面: ['时钟'], 窗: [] }), { common: true, desc: '看界面上有什么' });
    const r = await h.call('agent.send', { text: '看看桌面上有什么' });
    assert.equal(r.ok, true);
    assert.equal(r.reply, '看完了: 桌面上有一个时钟');
    assert.equal(轮, 2, '两轮: 一要工具二收尾');
    // common 能力真的变成了工具(名字 __ 化), 目录里有别的
    assert.ok(见过工具表.some(t => t.name === 'ui__state'), 'ui.state 成了工具');
    assert.ok(见过工具表.every(t => t.parameters), '工具都带参数形状');
    // 记录里: 用户 → assistant(要工具) → tool 结果 → assistant 收尾
    const 会话 = (await h.sub.get('agent.会话.' + (await h.call('agent.sessions'))[0].id)) || [];
    assert.equal(会话.filter(m => m.role === 'tool').length, 1);
    assert.ok(JSON.stringify(会话).includes('时钟'), '工具结果回灌进了记录');
    // 工具结果回灌的内容是 JSON(给模型看的)
    assert.match(会话.find(m => m.role === 'tool').content, /时钟/);
  }

  // ── 大脑那头断了: 隔会儿再问, 重试后成功 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/agent.js');
    let 轮 = 0;
    h.stub('ai.chat', async () => {
      轮++;
      if (轮 === 1) throw new Error('网络抖了一下');
      return { content: '重试后成功了', toolCalls: null };
    });
    const r = await h.call('agent.send', { text: '在吗' });
    assert.equal(r.reply, '重试后成功了');
    assert.equal(轮, 2, '重试了一次');
  }

  // ── 一直断: 照实报错, 不说做成 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/agent.js');
    h.stub('ai.chat', async () => { throw new Error('连不上'); });
    const r = await h.call('agent.send', { text: '在吗' });
    assert.equal(r.ok, false);
    assert.match(r.error, /连不上/);
  }

  // ── 系统提示: agent 能看自己的提示原文; 改这段就改规矩(段级编辑) ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/agent.js');
    h.stub('ai.chat', async () => ({ content: 'x', toolCalls: null }));
    const 提示 = await h.call('agent.prompt');
    assert.match(提示, /Mycelium 的全能 agent/);
    assert.match(提示, /用户就是它的开发者/, '透明性写在提示里');
    assert.match(提示, /## 工具\(\d+ 个/, '带工具清单');
    // 改「系统提示」段: agent 的规矩就变了(先 preview 再写)
    const 预 = await h.setNodule({ id: 'agent', preview: true, edits: [
      { name: '系统提示', replace: [{ old: '你是 Mycelium 的全能 agent。', new: '你是 Mycelium 的全能 agent(改过的规矩)。' }] },
    ] });
    assert.equal(预.preview, true);
    await h.setNodule({ id: 'agent', edits: [
      { name: '系统提示', replace: [{ old: '你是 Mycelium 的全能 agent。', new: '你是 Mycelium 的全能 agent(改过的规矩)。' }] },
    ] });
    assert.match(await h.call('agent.prompt'), /改过的规矩/);
    // 恢复出厂
    await h.setNodule({ id: 'agent', code: null });
    assert.doesNotMatch(await h.call('agent.prompt'), /改过的规矩/);
  }

  // ── 压缩接力: 超预算先把旧的写成摘要, 原文不删 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/agent.js');
    h.stub('ai.chat', async () => ({ content: '好的', toolCalls: null }));
    for (let i = 0; i < 3; i++) await h.call('agent.send', { text: '第' + i + '句, 说点长话把记录堆起来' });
    await h.sub.set('agent.设置.ctxBudget', 200, 'test');       // 预算压到 200 字
    await h.reboot();                                          // 让 agent 重新读预算
    let 压缩轮 = 0;
    h.stub('ai.chat', async ({ messages }) => {
      if (messages[0]?.role === 'system' && /接力摘要/.test(messages[0].content)) {
        压缩轮++;
        return { content: '【摘要】用户要在桌面上放个时钟', toolCalls: null };
      }
      return { content: '好的', toolCalls: null };
    });
    const r = await h.call('agent.send', { text: '继续' });
    assert.equal(r.ok, true);
    assert.ok(压缩轮 >= 1, '超预算触发了压缩');
    // 压完照跑, 不说崩
    assert.equal(r.reply, '好的');
  }

  // ── 引用: 附件不塞对话, 只放一行「[引用 …]」; 会话增删 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/agent.js');
    h.stub('ai.chat', async () => ({ content: '存好了', toolCalls: null }));
    await h.call('agent.send', { text: '记一下' });
    const 行 = await h.call('agent.attach', { name: '配置.json', text: '{"a":1}' });
    assert.match(行, /\[引用 配置\.json · text\/plain · 7 字 · ref:/);
    const 表 = await h.call('agent.sessions');
    assert.ok(表.length >= 1);
    assert.equal(表[0].题, '记一下');
    const 删 = await h.call('agent.compact');
    assert.equal(删.ok, false, '记录太短压不动, 照实说');
    assert.ok(删.why);
  }
};
