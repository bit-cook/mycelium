// @nodule {"id":"zz-source","name":"源头","version":1,"caps":["src"]}
'use strict';
// ══════════ 自报 ══════════
// 测试夹具: 提供一个可改的值, 演示借用、改块、自修改闭环
// ══════════ 值 ══════════
// 一个可改的对象。借用方拿到的是懒取值代理: 这边改, 那边看得见; 这边停用, 那边自动剪一份带走
const 值 = { 来自: '甲' };
// ══════════ 装配 ══════════
ctx.provide('src.改', a => { 值.来自 = a.text; return { 来自: 值.来自 }; },
  { desc: '改源头的值', schema: { text: { type: 'string' } } });
ctx.provide('src.值', () => 值, { desc: '源头的值(活的)', schema: {} });
return {};
