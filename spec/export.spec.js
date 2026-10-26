/* 导出 / 门禁 / 收养 / 离体: 代码传播协议的往返 */
import assert from 'node:assert/strict';
import { harness } from '../tools/harness.js';

export default async () => {
  // ── 导出整个系统: 门禁自洽(拆开再拼回一字不差) ──
  {
    const h = await harness();
    for (const b of ['ai', 'agent', 'desktop', 'pocket']) await h.load(`blocks/${b}.js`);
    const html = await h.build({});
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /<script id="hypha">/);
    assert.match(html, /data-id="ai"/);
    assert.match(html, /data-id="desktop"/);
    assert.match(html, /<!--MYCELIUM-LINEAGE/);
    assert.match(html, /↦ 借 hypha 的 离体运行时/, '块带着离体借用行导出');
    // 血统: 指纹 + 块版本清单
    const lin = /<!--MYCELIUM-LINEAGE (\{[\s\S]*?\})-->/.exec(html)[1];
    const 谱 = JSON.parse(lin);
    assert.equal(谱.blocks.length, 4);
    assert.ok(/^[0-9a-f]{16}$/.test(谱.id), '血统是双 hash 指纹');
  }

  // ── 只导出一块: 它借的(没在名单里的)段被剪成复制带走 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.load('blocks/desktop.js');
    const html = await h.build({ ids: ['desktop'] });
    // 桌面借了 ai 的选模型: ai 不在导出名单里 → 变成带指纹的复制, 不再是借用行
    assert.match(html, /源自: ai\/选模型/, '借的段剪成了复制');
    assert.match(html, /· 指纹: [0-9a-f]{8}/, '复制带指纹(分叉检测用)');
    assert.doesNotMatch(html, /data-id="ai"/, '名单里没有 ai');
    assert.match(html, /data-id="desktop"/);
  }

  // ── 收养回一个有 ai 的系统: 复制换回借用行(不分叉才换) ──
  {
    const h1 = await harness();
    await h1.load('blocks/ai.js');
    await h1.load('blocks/desktop.js');
    const html = await h1.build({ ids: ['desktop'] });

    const h2 = await harness();
    await h2.load('blocks/ai.js');
    await h2.load('blocks/desktop.js');
    const 报 = await h2.call('hypha.adopt', { text: html });
    assert.ok(报.some(r => r.result.includes('换回了借用行')), '认亲: 复制换回借用行 ' + JSON.stringify(报));
    const 桌 = await h2.read('desktop');
    const 段 = 桌.segs.find(s => s.name === '选模型');
    assert.deepEqual({ ...段.map }, { block: 'ai', name: '选模型' }, '又是借用了, 不是复制');
  }

  // ── 收养进一个没有 ai 的系统: 复制就是复制, 照跑 ──
  {
    const h1 = await harness();
    await h1.load('blocks/ai.js');
    await h1.load('blocks/desktop.js');
    const html = await h1.build({ ids: ['desktop'] });

    const h3 = await harness();
    const 报 = await h3.call('hypha.adopt', { text: html });
    assert.ok(报.some(r => r.result.includes('已收养')), '未知 id: 收养(禁用)');
    const 桌 = await h3.read('desktop');
    assert.equal(桌.segs.find(s => s.name === '选模型').map, null, '复制段(没有借用行)');
    // 启用后照跑: 桌面块的全部能力都在
    await h3.setNodule({ id: 'desktop', enabled: true });
    assert.ok((await h3.call('ui.state')).窗 !== undefined);
  }

  // ── 离体导出(孢子): 自带离体运行时, 没有完整内核 ──
  {
    const h = await harness();
    for (const b of ['ai', 'agent', 'desktop', 'pocket']) await h.load(`blocks/${b}.js`);
    const html = await h.build({ ids: ['desktop'], stem: false });
    assert.match(html, /离体运行时/, '自带离体运行时');
    assert.doesNotMatch(html, /<script id="hypha-launcher">[\s\S]*mycelium\.boot/, '没有完整启动器');
    assert.match(html, /data-id="desktop"/);
    assert.doesNotMatch(html, /data-id="ai"/, '只带了桌面');
    // 离体文件里的桌面依然完整(它借 ai 的选模型已剪成复制)
    assert.match(html, /源自: ai\/选模型/);
    // 离体文件再被收养进整系统: 借用行指着宿主内核的离体运行时
    const h2 = await harness();
    await h2.load('blocks/ai.js');
    const 报 = await h2.call('hypha.adopt', { text: html });
    assert.ok(报.some(r => r.id === 'desktop' && r.result.includes('已收养')));
    await h2.setNodule({ id: 'desktop', enabled: true });
    const 桌 = await h2.read('desktop');
    assert.deepEqual({ ...桌.segs.find(s => s.name === '离体运行时').map },
      { block: 'hypha', name: '离体运行时' }, '离体借用行指着内核');
  }

  // ── 没借内核的块离体导出: 说清差什么, 不产出打不开的文件 ──
  {
    const h = await harness();
    await h.load('spec/fixtures/zz-source.js');     // 夹具不借内核
    await assert.rejects(() => h.build({ ids: ['zz-source'], stem: false }), /也没借内核的代码/);
  }

  // ── 门禁: 分叉的复制不许换回(指纹对不上) ──
  {
    const h1 = await harness();
    await h1.load('blocks/ai.js');
    await h1.load('blocks/desktop.js');
    const html = await h1.build({ ids: ['desktop'] });
    // 改掉复制里的正文(分叉), 再往有 ai 的系统里导: 换不回, 保留复制
    const 分叉 = html.replace(/(· 指纹: [0-9a-f]{8} ═\n)/, '$1const 分叉标记 = 1;\n');
    assert.notEqual(分叉, html, '真的改动了复制里的正文');
    const h2 = await harness();
    await h2.load('blocks/ai.js');
    await h2.load('blocks/desktop.js');
    const 报 = await h2.call('hypha.adopt', { text: 分叉 });
    assert.ok(报.some(r => /保留复制|分叉/.test(r.result)), '分叉的复制保留, 不乱换: ' + JSON.stringify(报));
  }
};
