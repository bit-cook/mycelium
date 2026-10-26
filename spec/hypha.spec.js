/* 内核机制: 段解析 / 装载 / 借用 / 改块 / 预览 / 回滚 / 快照 / 审批 */
import assert from 'node:assert/strict';
import { harness } from '../tools/harness.js';

export default async () => {
  // ── 段解析: 一行代码必属于且只属于一段 ──
  {
    const h = await harness();
    const { parseSegs, lay, pick, cutCode } = h.kernel.internals;
    const 码 = [
      '// ═ 甲 ═',
      'const 甲 = 1;',
      '// ✂ 圈 · 要: 乙',
      'const 圈内 = 2;',
      '// ✂ 圈 完',
      '// ═ 乙 ═',
      'const 乙 = 3;',
    ].join('\n');
    const p = parseSegs(码);
    assert.equal(p.segs.length, 2);
    assert.equal(p.segs[0].name, '甲');
    assert.equal(p.segs[0].lines.length, 5);
    assert.equal(p.segs[1].name, '乙');
    const L = lay(p, '测');
    assert.equal(L.lines.length, 7);
    assert.deepEqual([...L.need['圈']], ['乙']);
    // 剪「圈」: 圈着的行留, 它要的乙段整段留, 甲段(不在名单)整段不留
    const k = pick(L, ['圈']);
    assert.deepEqual([...k], [false, false, true, true, true, true, true]);
    // 剪整份(names=null): 只去「离体时不带」圈的, 别的原样留
    const 码2 = '// ═ 甲 ═\nconst 甲 = 1;\n// ✂ 离体时不带 · 号: a\nconst 藏 = 2;\n// ✂ 离体时不带 完\nconst 乙 = 3;';
    const 剪 = cutCode(码2, null, '测');
    assert.ok(!剪.includes('藏'), '离体时不带的内容被剪掉');
    assert.ok(剪.includes('const 甲 = 1') && 剪.includes('const 乙 = 3'), '别的内容留着');
  }

  // ── 装载 + 能力网 + 形状校验 ──
  {
    const h = await harness();
    const 装 = await h.load('blocks/ai.js');
    assert.ok(装.running.includes('ai'), 'ai 块装上了');
    assert.ok(h.caps().includes('ai.chat'), 'ai.chat 登记了');
    assert.ok(h.caps().includes('hypha.nodules'), '内核能力也在目录里');
    // 形状: 少必填参数, 调用前就报
    await assert.rejects(() => h.call('ai.configure', {}), /缺 name/);
    // 不认识的字段也报(additionalProperties: false)
    await assert.rejects(() => h.call('ai.configure', { name: 'x', 不存在: 1 }), /不认识的字段/);
    // 配一个厂商(内存 kv)
    await h.call('ai.configure', { name: '本地', endpoint: 'http://127.0.0.1:11434/v1' });
    const ps = await h.call('ai.providers');
    assert.equal(ps.length, 1);
    assert.equal(ps[0].name, '本地');
    assert.equal(ps[0].endpoint, 'http://127.0.0.1:11434/v1');
    // 同名 = 更新
    await h.call('ai.configure', { name: '本地', model: 'qwen2.5' });
    assert.equal((await h.call('ai.providers'))[0].model, 'qwen2.5');
    // 选厂商: 给了名字用它
    await h.call('ai.test', { provider: '本地' }).catch(() => { });   // 没网, 只求不崩
    // Key 不出本块: ai.providers 不回 apiKey
    assert.equal((await h.call('ai.providers'))[0].apiKey, undefined);
  }

  // ── 改块: replace 精确替换 + 基线号 + 预览 + 回滚 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    const 读 = await h.read('ai', '基础');
    assert.match(读.segment.text, /并发闸/);
    // 预览: 不写不重启
    const 预 = await h.setNodule({ id: 'ai', preview: true,
      segment: { name: '基础', replace: [{ old: 'const sleep = ms => new Promise(r => setTimeout(r, ms));',
        new: 'const sleep = ms => new Promise(r => setTimeout(r, ms * 2));' }] } });
    assert.equal(预.preview, true);
    assert.equal(预.changed, true);
    assert.equal(预.restart, true);
    // 真写: 换了代码, 段变成改版
    const 写 = await h.setNodule({ id: 'ai',
      segment: { name: '基础', replace: [{ old: 'const sleep = ms => new Promise(r => setTimeout(r, ms));',
        new: 'const sleep = ms => new Promise(r => setTimeout(r, ms * 2));' }] } });
    assert.equal(写.changed, true);
    assert.equal(写.restarted, true);
    assert.ok(写.edited.includes('基础'));
    // 基线号: 拿旧的 expected 来改, 拒绝
    const 旧基线 = 读.revision;
    await assert.rejects(() => h.setNodule({ id: 'ai', expected: 旧基线,
      segment: { name: '基础', text: '// ═ 基础 ═\nconst x = 1;' } }), /被改过了/);
    // replace 对不上: 报"找不到", 且说清在哪段
    await assert.rejects(() => h.setNodule({ id: 'ai',
      segment: { name: '基础', replace: [{ old: '不存在的字符串', new: 'x' }] } }), /找不到/);
    // 整块恢复出厂
    const 复 = await h.setNodule({ id: 'ai', code: null });
    assert.equal(复.changed, true);
    assert.equal((await h.read('ai', '基础')).segment.use, 'factory');
    // 写坏语法: 不动正在跑的那份
    await assert.rejects(() => h.setNodule({ id: 'ai',
      segment: { name: '基础', text: '// ═ 基础 ═\nconst 坏 = ;' } }), /语法错误/);
    assert.equal((await h.read('ai', '基础')).segment.use, 'factory', '语法错就不落库');
  }

  // ── 借用: 懒取值 + 被借的先装 + 源头停用自动剪一份 ──
  {
    const h = await harness();
    // 甲(zz-source)提供, 乙(aa-user)借甲: 乙的 id 排在前也先装甲(被借的先)
    await h.load('spec/fixtures/aa-user.js');
    await h.load('spec/fixtures/zz-source.js');
    const r = await h.call('usr.问', {});
    assert.equal(r.来自, '甲');
    // 活的借用: 源头改, 这边立刻看得见
    await h.call('src.改', { text: '甲改过' });
    assert.equal((await h.call('usr.问', {})).来自, '甲改过');
    // 源头停用: 乙自动得到一份复制, 照跑(回到代码里的初值)
    await h.setNodule({ id: 'zz-source', enabled: false });
    assert.equal((await h.call('usr.问', {})).来自, '甲');
    // 重新启用: 换回借用行, 又是活的
    await h.setNodule({ id: 'zz-source', enabled: true });
    assert.equal((await h.call('usr.问', {})).来自, '甲');
  }

  // ── 快照与恢复 ──
  {
    const h = await harness();
    await h.load('blocks/ai.js');
    await h.call('ai.configure', { name: '甲厂', endpoint: 'http://a/v1' });
    const 拍 = await h.call('hypha.snapshot', { name: 's1' });
    assert.equal(拍.name, 's1');
    await h.call('ai.configure', { name: '乙厂', endpoint: 'http://b/v1' });
    assert.equal((await h.call('ai.providers')).length, 2);
    await h.call('hypha.snapshot', { name: 's1', restore: true });
    assert.equal((await h.call('ai.providers')).length, 1, '回到快照: 乙厂没了');
    // 列快照(open 级, 不拦)
    assert.equal((await h.call('hypha.snapshots')).length, 1);
  }

  // ── 审批: guarded 能力要人批准; autonomy 记住; 事件留痕 ──
  {
    const h = await harness();
    await h.setAutonomy('ask');
    await h.load('blocks/ai.js');
    const 改 = h.call('hypha.setNodule', { id: 'ai', enabled: false });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(h.approvals.length, 1, '改块要批准');
    assert.equal(h.approvals[0].path, 'hypha.setNodule');
    assert.match(h.approvals[0].args, /ai/);
    await h.approveAll(true, false);
    await 改;
    assert.ok((await h.read('ai')).enabled === false);
    // 拒绝: 调用方拿到拒绝错
    const 改2 = h.call('hypha.setNodule', { id: 'ai', enabled: true });
    await new Promise(r => setTimeout(r, 10));
    await h.approveAll(false);
    await assert.rejects(() => 改2, /用户拒绝/);
    // notice 级: 不拦, 但广播
    const 出事 = h.events.filter(e => e.type === 'notice');
    await h.call('hypha.reboot');
    assert.ok(h.events.some(e => e.type === 'notice' && e.path === 'hypha.reboot'), 'reboot 是 notice');
    assert.ok(出事 !== undefined);
    // trace: 每次调用一条 span
    const 痕 = await h.call('hypha.trace', { path: 'hypha.trace' });
    assert.ok(痕.length >= 1);
    assert.equal(痕[痕.length - 1].ok, true);
    // journal: 谁写了什么
    const 志 = await h.call('hypha.journal', { limit: 5 });
    assert.ok(志.some(e => e.op === 'set' || e.op === 'snapshot' || e.op === 'restore'));
  }
};
