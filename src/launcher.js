/* 启动器: 全文件唯一物理不可改的代码。
   职责只有三件: 认血统(指纹)、注入 env、调 boot。
   内核(hypha)是可改的"一块", 启动器不是 —— 改内核改坏了, 刷新还能从这里重新起来。 */
(function () {
  'use strict';
  var m = /<!--MYCELIUM-LINEAGE ([\s\S]*?)-->/.exec(document.documentElement.outerHTML), lin = null;
  try { lin = m && JSON.parse(m[1]); } catch (e) { }
  var id = (lin && lin.id) || 'dev', key = 'mycelium.' + id;
  // 崩溃计数: 连续启动失败 3 次 → 安全模式(忽略全部改版), 改版内核连续崩也能退回原版
  var S = null, crash = 0, use = null, ed = null, safe = false;
  try {
    S = localStorage;
    crash = +S.getItem(key + '.crash') || 0;
    use = S.getItem(key + '.use');
    ed = S.getItem(key + '.edited');
    S.setItem(key + '.crash', String(crash + 1));
  } catch (e) { }
  var solo = !document.getElementById('hypha');        // 离体文件: 没有内核, 块自己带剪来的内核范围
  if (crash >= 3) {
    safe = true;
    if (use === 'edited' && !solo) { try { S.setItem(key + '.use', 'factory'); } catch (e) { } }
  }
  if (/[?&]safe=1/.test(location.search)) safe = true;
  var env = {
    doc: document,
    win: window,
    ls: S,
    idb: typeof indexedDB !== 'undefined' ? indexedDB : null,
    fetch: window.fetch.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    boot: { id: id, lineage: lin, solo: solo, safe: safe, key: key },
  };
  if (solo) {
    // 离体: 内核范围已被剪进文件(Stem 标签里只有需要的几段), 整份就是内核
    var el = document.getElementById('hypha');
    (0, eval)(el ? el.textContent : '');
  }
  window.mycelium.boot(env);
})();
