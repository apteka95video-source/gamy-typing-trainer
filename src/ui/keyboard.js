// Екранна клавіатура: схема пальців, підказка наступної клавіші (лише в тренуванні), карта помилок.

import { FINGERS, HOME_KEY_OF_FINGER, KEYS, KEY_ROWS, LAYOUTS, keyInfo, shiftFingerFor } from '../core/layouts.js';
import { h } from './dom.js';

const HOME_CODES = new Set(Object.values(HOME_KEY_OF_FINGER));
const BUMP_CODES = new Set(['KeyF', 'KeyJ']);

function wide(label, span, extra = '') {
  return h('span', { class: `kb-key wide ${extra}`.trim(), style: { gridColumn: `span ${span}` } }, label);
}

/**
 * @param {object} p
 * @param {'en'|'uk'} p.lang
 * @param {Iterable<string>} [p.focus]   символи, які треба виділити на схемі
 * @param {string|null} [p.next]         наступний символ (підказка; використовується лише в тренуванні)
 * @param {Set<string>|null} [p.opened]  якщо задано, решта клавіш притлумлюються
 * @param {Map<string, {rate: number, errors: number}>} [p.heat] карта помилок
 */
export function renderKeyboard({ lang, focus = [], next = null, opened = null, heat = null }) {
  const layout = LAYOUTS[lang];
  const focusCodes = new Set();
  let needShift = null;
  for (const ch of focus) {
    const info = keyInfo(ch, lang);
    if (info) focusCodes.add(info.code);
  }
  const nextInfo = next ? keyInfo(next, lang) : null;
  if (nextInfo?.shift) needShift = FINGERS[shiftFingerFor(next, lang)].hand;

  const openedCodes = opened ? new Set([...opened].map((ch) => keyInfo(ch, lang)?.code).filter(Boolean)) : null;

  const key = (code) => {
    const info = KEYS[code];
    const ch = layout.base[code] ?? '';
    const classes = ['kb-key', `f-${info.finger}`];
    if (HOME_CODES.has(code)) classes.push('home');
    if (BUMP_CODES.has(code)) classes.push('bump');
    if (focusCodes.has(code)) classes.push('focus');
    if (nextInfo?.code === code) classes.push('next');
    if (openedCodes && !openedCodes.has(code)) classes.push('dim');
    const children = [ch === ' ' ? '' : ch.toUpperCase()];
    const stat = heat?.get(code);
    if (stat && stat.errors >= 0.5) {
      classes.push(stat.rate >= 0.12 ? 'hot2' : 'hot1');
      children.push(h('span', { class: 'heat' }, `${Math.round(stat.rate * 100)}%`));
    }
    return h('span', { class: classes.join(' '), title: `${ch.toUpperCase()} — ${FINGERS[info.finger].name}`, dataset: { code } }, children);
  };

  const shiftClass = (hand) => (needShift === hand ? 'next' : '');
  const rows = [
    [...KEY_ROWS[0].map(key), wide('Backspace', 4)],
    [wide('Tab', 3), ...KEY_ROWS[1].slice(0, 12).map(key), h('span', { class: `kb-key f-R5${openedCodes && !openedCodes.has('Backslash') ? ' dim' : ''}`, style: { gridColumn: 'span 3' } }, layout.base.Backslash)],
    [wide('Caps', 4), ...KEY_ROWS[2].map(key), wide('Enter', 4)],
    [wide('Shift', 5, `f-L5 ${shiftClass('L')}`), ...KEY_ROWS[3].map(key), wide('Shift', 5, `f-R5 ${shiftClass('R')}`)],
    [
      h('span', { style: { gridColumn: 'span 8' } }),
      h('span', { class: `kb-key wide f-T${nextInfo?.code === 'Space' ? ' next' : ''}${focusCodes.has('Space') ? ' focus' : ''}`, style: { gridColumn: 'span 14' }, title: 'Пробіл — великий палець' }, 'пробіл'),
      wide('AltGr', 4, nextInfo?.altGr ? 'next' : ''),
      h('span', { style: { gridColumn: 'span 4' } }),
    ],
  ];

  const label = `Схема клавіатури (${layout.name}): колір клавіші показує палець, рамка — домашній ряд.`;
  return h('div', { class: 'keyboard', role: 'img', 'aria-label': label }, rows.map((cells) => h('div', { class: 'kb-row' }, cells)));
}

export function fingerLegend() {
  const items = [
    ['pinky', 'мізинці'],
    ['ring', 'безіменні'],
    ['middle', 'середні'],
    ['index', 'вказівні'],
    ['thumb', 'великі (пробіл)'],
  ];
  return h('ul', { class: 'legend', 'aria-label': 'Позначення пальців' }, [
    ...items.map(([cls, name]) => h('li', {}, h('span', { class: `swatch ${cls}`, 'aria-hidden': 'true' }), name)),
    h('li', {}, h('span', { class: 'keycap', 'aria-hidden': 'true' }, 'F'), 'жирна рамка — домашній ряд, риска — виступ під вказівним'),
  ]);
}

/** Таблиця «палець → клавіші» для обраної розкладки (текстова альтернатива схемі). */
export function fingerTable(lang) {
  const layout = LAYOUTS[lang];
  const order = ['L5', 'L4', 'L3', 'L2', 'R2', 'R3', 'R4', 'R5', 'T'];
  const rows = order.map((finger) => {
    const chars = [];
    for (const row of [1, 2, 3]) {
      for (const code of KEY_ROWS[row]) if (KEYS[code].finger === finger && layout.base[code]) chars.push(layout.base[code].toUpperCase());
    }
    const home = layout.base[HOME_KEY_OF_FINGER[finger]];
    return h('tr', {}, [
      h('th', { scope: 'row' }, FINGERS[finger].name),
      h('td', { class: 'mono' }, finger === 'T' ? 'пробіл' : chars.join(' ')),
      h('td', { class: 'mono' }, finger === 'T' ? 'пробіл' : home.toUpperCase()),
    ]);
  });
  return h('div', { class: 'table-scroll' }, h('table', {}, [
    h('caption', {}, `${layout.name}: одна клавіша — один палець`),
    h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Палець'), h('th', { scope: 'col' }, 'Літерні клавіші'), h('th', { scope: 'col' }, 'Домашня клавіша')])),
    h('tbody', {}, rows),
  ]));
}
