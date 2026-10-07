// Мінімальні помічники для побудови DOM без шаблонів і innerHTML (жодного HTML із даних).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'dataset') Object.assign(el.dataset, value);
    else if (name === 'style') Object.assign(el.style, value);
    else if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2), value);
    else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Замінює вміст елемента; null/false серед дітей пропускаються. */
export function mount(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(name, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const fmt = {
  int: (value) => String(Math.round(value)),
  pct: (value) => `${(Math.floor(value * 10) / 10).toFixed(1).replace('.', ',')} %`,
  one: (value) => value.toFixed(1).replace('.', ','),
};

export function keycaps(chars) {
  return h('span', { class: 'keys' }, [...chars].map((ch) => h('span', { class: 'keycap' }, ch === ' ' ? '␣' : ch)));
}
