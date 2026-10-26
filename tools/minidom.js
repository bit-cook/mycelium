/* 迷你 DOM: 刚好够桌面块跑起来的真父子树 + 选择器 + innerHTML 解析。
   存在的意义: 桌面块的布局代码(收编、窗口、层叠)从没有自动化测试——
   一次"#desk 盖住块的界面导致点不进输入框"的 bug 之后, 这类回归必须被测试挡住。 */
const 驼 = k => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class 元 {
  constructor(签) {
    this.签 = 签; this.子 = []; this.父 = null; this.属性 = {}; this.听 = {};
    this.样式 = {}; this.style = {}; this.类 = new Set(); this.dataset = {}; this._文 = ''; this.id = '';
    this.value = ''; this.hidden = false; this.textContent = '';
    const 自 = this;
    this.classList = {
      add: (...cs) => cs.forEach(c => 自.类.add(c)),
      remove: (...cs) => cs.forEach(c => 自.类.delete(c)),
      toggle: c => 自.类.has(c) ? 自.类.delete(c) : 自.类.add(c),
      contains: c => 自.类.has(c),
    };
  }
  set innerHTML(v) { this._文 = String(v); this.子 = 解析(String(v), this); }
  get innerHTML() { return this._文; }
  get className() { return [...this.类].join(' '); }
  set className(v) { this.类 = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) {
    this.属性[k] = String(v);
    if (k === 'id') this.id = String(v);
    if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => this.类.add(c));
    if (k.startsWith('data-')) this.dataset[驼(k.slice(5))] = String(v);
  }
  getAttribute(k) { return k in this.属性 ? this.属性[k] : null; }
  appendChild(子) {
    if (子.父 && 子.父 !== this) 子.父.子 = 子.父.子.filter(x => x !== 子);   // 真 DOM 的移动语义
    子.父 = this; this.子.push(子); 子.已摘 = false; return 子;
  }
  prepend(...些) { 些.forEach((子, i) => { if (子.父) 子.remove(); 子.父 = this; this.子.splice(i, 0, 子); }); }
  remove() {
    if (this.父) { this.父.子 = this.父.子.filter(x => x !== this); this.父 = null; }
    this.已摘 = true;                      // 查询不再返回它(和真 DOM 的 isConnected 一个意思)
  }
  addEventListener(t, fn) { (this.听[t] = this.听[t] || []).push(fn); }
  removeEventListener(t, fn) { this.听[t] = (this.听[t] || []).filter(f => f !== fn); }
  dispatchEvent(e) { (this.听[e.type] || []).forEach(fn => fn(e)); return true; }
  closest(择) { let p = this; while (p) { if (配(p, 择)) return p; p = p.父; } return null; }
  querySelector(择) { return this.querySelectorAll(择)[0] || null; }
  querySelectorAll(择) { const 出 = []; 走(this, e => { if (e !== this && !e.已摘 && 全配(e, 择)) 出.push(e); }); return 出; }
  get outerHTML() {
    const 属 = Object.entries(this.属性).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${this.签}${属}>${this._文 || this.textContent || ''}</${this.签}>`;
  }
}

// 极简 HTML 解析: 只认完整标签+引号属性, 文本丢掉(桌面代码不读文本)
function 解析(html, 父) {
  const 根 = [], 栈 = [];
  const re = /<\/?([a-z][\w-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/?)>/gi;
  let m, 文头 = 0;
  while ((m = re.exec(html))) {
    if (m.index > 文头 && 栈.length) 栈[栈.length - 1].textContent += html.slice(文头, m.index).trim();
    文头 = m.index + m[0].length;
    const 新元 = new (globalThis.__小元类 || 元)(m[1]);
    const ar = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let a; while ((a = ar.exec(m[2] || ''))) 新元.setAttribute(a[1], a[2] ?? a[3] ?? a[4]);
    if (m[0][1] === '/') {
      // 闭合: 按标签名往上找最近的同名开标签(不能按对象比: 每次匹配都新建对象)
      const 名 = m[1].toLowerCase();
      for (let i = 栈.length - 1; i >= 0; i--) {
        if (栈[i].签 === 名) { 栈.length = i; break; }
      }
      continue;
    }
    (栈.length ? 栈[栈.length - 1].子 : 根).push(新元);
    新元.父 = 栈.length ? 栈[栈.length - 1] : (父 || null);   // 顶层子元素的父是设 innerHTML 的宿主
    if (!m[3]) 栈.push(新元);
  }
  return 根;
}

function 走(e, fn) { fn(e); e.子.forEach(c => 走(c, fn)); }

// 选择器: 支持测试用到的形式 —— #id / .class / [attr] / [attr=v] / tag / tag[attr=v] / 后代 / 直接子代(>)
function 配(e, 择) {
  const 部 = String(择).match(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|[\w-]+(?:\[[^\]]*\])?/g) || [];
  return 部.length > 0 && 部.every(p => {
    if (p.startsWith('#')) return e.id === p.slice(1);
    if (p.startsWith('.')) return e.类.has(p.slice(1));
    const a = /^([\w-]*)\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p);
    if (a) {
      if (a[1] && e.签 !== a[1]) return false;
      const v = e.getAttribute(a[2]);
      return a[3] === undefined ? v !== null : v === a[3];
    }
    return e.签 === p;
  });
}
// 从右往左配: '>' 要求直接父子, 空格允许任意层祖先
function 全配(e, 择) {
  const 些 = String(择).trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  if (!配(e, 些[些.length - 1])) return false;
  let 点 = e.父, i = 些.length - 2;
  while (i >= 0 && 点) {
    if (些[i] === '>') {
      i--;
      if (i < 0 || !配(点, 些[i])) return false;
      点 = 点.父; i--;
    } else {
      while (点 && !配(点, 些[i])) 点 = 点.父;
      if (!点) return false;
      点 = 点.父; i--;
    }
  }
  return i < 0;
}

export function 新元(签 = 'div', 属性 = {}) {
  const e = new 元(签);
  Object.entries(属性).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

export function 小文档(块根 = []) {
  const doc = new 元('document');
  doc.head = new 元('head'); doc.body = new 元('body');
  doc.appendChild(doc.head); doc.appendChild(doc.body);      // 必须挂进树, 不然走不到
  doc.readyState = 'complete';
  const 根 = new 元('div'); 根.id = 'mycelium-root';
  doc.body.appendChild(根);
  块根.forEach(({ id, 子 = [] }) => {
    const el = new 元('div');
    el.setAttribute('data-nodule-id', id);
    子.forEach(c => el.appendChild(c));
    根.appendChild(el);
  });
  doc.createElement = 签 => new 元(签);
  doc.getElementById = id => { let 找 = null; 走(doc, e => { if (!找 && e.id === id) 找 = e; }); return 找; };
  doc.dispatchEvent = e => {
    const 发 = n => (n.听[e.type] || []).forEach(fn => fn(e));
    走(doc, 发); return true;
  };
  return { doc, 根 };
}
