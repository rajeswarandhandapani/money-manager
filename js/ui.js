// Small helpers shared by the screens and charts.

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const fmt = cents => money.format(cents / 100);
export const fmtShort = cents => {
  const sign = cents < 0 ? '-' : '';
  const size = Math.abs(cents);
  return size >= 100000 ? `${sign}$${(size / 100000).toFixed(1).replace(/\.0$/, '')}k` : `${sign}$${Math.round(size / 100)}`;
};

/** Builds DOM safely: bank text only ever becomes text nodes, never HTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

export function select(label, value, options, onchange, extra = {}) {
  const el = h('select', { 'aria-label': label, ...extra, onchange: () => onchange(el.value) },
    options.map(o => {
      const [v, text] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: v === value }, text);
    }));
  return el;
}

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
