// Розкладки, фізичні клавіші та розподіл пальців.
// Базове правило ТЗ: одна фізична клавіша — один визначений палець.

export const FINGERS = {
  L5: { hand: 'L', name: 'лівий мізинець', short: 'л. мізинець' },
  L4: { hand: 'L', name: 'лівий безіменний', short: 'л. безіменний' },
  L3: { hand: 'L', name: 'лівий середній', short: 'л. середній' },
  L2: { hand: 'L', name: 'лівий вказівний', short: 'л. вказівний' },
  T: { hand: 'T', name: 'великий палець', short: 'великий' },
  R2: { hand: 'R', name: 'правий вказівний', short: 'пр. вказівний' },
  R3: { hand: 'R', name: 'правий середній', short: 'пр. середній' },
  R4: { hand: 'R', name: 'правий безіменний', short: 'пр. безіменний' },
  R5: { hand: 'R', name: 'правий мізинець', short: 'пр. мізинець' },
};

export const FINGER_ORDER = ['L5', 'L4', 'L3', 'L2', 'R2', 'R3', 'R4', 'R5'];

// Ряди фізичної клавіатури (ANSI): код клавіші та закріплений палець.
// row: 0 — цифровий, 1 — верхній, 2 — домашній, 3 — нижній, 4 — пробіл.
const ROW_CODES = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
  ['Space'],
];

const ROW_FINGERS = [
  ['L5', 'L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2', 'R3', 'R4', 'R5', 'R5', 'R5'],
  ['L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2', 'R3', 'R4', 'R5', 'R5', 'R5', 'R5'],
  ['L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2', 'R3', 'R4', 'R5', 'R5'],
  ['L5', 'L4', 'L3', 'L2', 'L2', 'R2', 'R2', 'R3', 'R4', 'R5'],
  ['T'],
];

/** Усі підтримувані фізичні клавіші: code → { code, row, col, finger }. */
export const KEYS = (() => {
  const keys = {};
  ROW_CODES.forEach((codes, row) => {
    codes.forEach((code, col) => {
      keys[code] = { code, row, col, finger: ROW_FINGERS[row][col] };
    });
  });
  return keys;
})();

export const KEY_ROWS = ROW_CODES;

/** Домашня клавіша кожного пальця (куди палець повертається після натискання). */
export const HOME_KEY_OF_FINGER = {
  L5: 'KeyA', L4: 'KeyS', L3: 'KeyD', L2: 'KeyF',
  R2: 'KeyJ', R3: 'KeyK', R4: 'KeyL', R5: 'Semicolon',
  T: 'Space',
};

// Символи рядів: [без Shift, із Shift].
const EN_ROWS = [
  ['`1234567890-=', '~!@#$%^&*()_+'],
  ['qwertyuiop[]\\', 'QWERTYUIOP{}|'],
  ["asdfghjkl;'", 'ASDFGHJKL:"'],
  ['zxcvbnm,./', 'ZXCVBNM<>?'],
];

// Українська ЙЦУКЕН (еталон — «Українська (розширена)» у Windows; апостроф — клавіша зліва від 1,
// ґ — AltGr+Г). На інших системах ті самі символи можуть бути на сусідніх клавішах: програма
// перевіряє набраний символ, а схема пальців показує еталонне розташування.
const UK_ROWS = [
  ["'1234567890-=", '₴!"№;%:?*()_+'],
  ['йцукенгшщзхї\\', 'ЙЦУКЕНГШЩЗХЇ/'],
  ['фівапролджє', 'ФІВАПРОЛДЖЄ'],
  ['ячсмитьбю.', 'ЯЧСМИТЬБЮ,'],
];

function buildLayout(id, name, rows, extras = []) {
  const chars = {}; // символ → { code, shift, altGr }
  const base = {}; // code → символ без Shift
  rows.forEach(([plain, shifted], row) => {
    [...plain].forEach((ch, col) => {
      const code = ROW_CODES[row][col];
      base[code] = ch;
      chars[ch] = { code, shift: false, altGr: false };
    });
    [...shifted].forEach((ch, col) => {
      const code = ROW_CODES[row][col];
      if (!(ch in chars)) chars[ch] = { code, shift: true, altGr: false };
    });
  });
  for (const extra of extras) chars[extra.ch] = { code: extra.code, shift: extra.shift, altGr: true };
  chars[' '] = { code: 'Space', shift: false, altGr: false };
  base.Space = ' ';
  return { id, name, chars, base };
}

export const LAYOUTS = {
  en: buildLayout('en', 'English QWERTY', EN_ROWS),
  uk: buildLayout('uk', 'Українська ЙЦУКЕН', UK_ROWS, [
    { ch: 'ґ', code: 'KeyU', shift: false },
    { ch: 'Ґ', code: 'KeyU', shift: true },
  ]),
};

export const HOME_ROW = {
  en: { left: 'asdf', right: 'jkl;' },
  uk: { left: 'фіва', right: 'олдж' },
};

/** Опис клавіші для символу: палець, рука, ряд, чи потрібен Shift. null — символ не підтримується. */
export function keyInfo(ch, lang) {
  const entry = LAYOUTS[lang].chars[ch];
  if (!entry) return null;
  const key = KEYS[entry.code];
  return {
    ch,
    code: entry.code,
    shift: entry.shift,
    altGr: entry.altGr,
    row: key.row,
    col: key.col,
    finger: key.finger,
    hand: FINGERS[key.finger].hand,
  };
}

export function fingerOf(ch, lang) {
  return keyInfo(ch, lang)?.finger ?? null;
}

/** Символ домашньої клавіші того пальця, яким набирається ch. */
export function homeCharOf(ch, lang) {
  const info = keyInfo(ch, lang);
  if (!info) return null;
  return LAYOUTS[lang].base[HOME_KEY_OF_FINGER[info.finger]];
}

/** Яким мізинцем тримати Shift: протилежною до літери рукою. */
export function shiftFingerFor(ch, lang) {
  const info = keyInfo(ch, lang);
  if (!info || !info.shift) return null;
  return info.hand === 'L' ? 'R5' : 'L5';
}

export function isSupportedChar(ch, lang) {
  return ch in LAYOUTS[lang].chars;
}

/**
 * Характер переходу між двома символами:
 *  sameKey — та сама клавіша; sameFinger — один палець, різні клавіші;
 *  alternate — різні руки; roll — сусідні пальці однієї руки; sameHand — інше.
 */
export function transitionKind(a, b, lang) {
  const ka = keyInfo(a, lang);
  const kb = keyInfo(b, lang);
  if (!ka || !kb) return 'unknown';
  if (ka.code === kb.code) return 'sameKey';
  if (ka.finger === kb.finger) return 'sameFinger';
  if (ka.hand !== kb.hand) return 'alternate';
  const ia = FINGER_ORDER.indexOf(ka.finger);
  const ib = FINGER_ORDER.indexOf(kb.finger);
  return Math.abs(ia - ib) === 1 ? 'roll' : 'sameHand';
}

/** Людський опис клавіші: «правий вказівний, домашній ряд». */
export function describeKey(ch, lang) {
  const info = keyInfo(ch, lang);
  if (!info) return '';
  const rows = ['цифровий ряд', 'верхній ряд', 'домашній ряд', 'нижній ряд', 'пробіл'];
  if (ch === ' ') return 'великий палець, пробіл';
  let text = `${FINGERS[info.finger].name}, ${rows[info.row]}`;
  if (info.shift) text += `, Shift — ${FINGERS[shiftFingerFor(ch, lang)].name}`;
  if (info.altGr) text += ', з AltGr (правий Alt)';
  return text;
}

export function displayChar(ch) {
  return ch === ' ' ? 'пробіл' : ch;
}
