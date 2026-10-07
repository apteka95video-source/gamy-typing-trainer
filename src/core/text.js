// Нормалізація тексту та опис слова. Модуль без залежностей від DOM:
// його однаково використовують браузер, скрипти обробки словників і тести.

export const ALPHABETS = {
  en: 'abcdefghijklmnopqrstuvwxyz',
  uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
};

/** Однолітерні слова, які справді існують у мові (решта однолітерних токенів — шум). */
export const SINGLE_LETTER_WORDS = {
  en: ['a'],
  uk: ['а', 'в', 'є', 'з', 'і', 'й', 'о', 'у', 'я'],
};

// Варіанти апострофа, які зводяться до U+0027:
// U+2019 ’ (типографський), U+02BC ʼ (літера-апостроф), U+2018 ‘, U+0060 ` (клавіша зліва від 1).
const APOSTROPHES = /[’ʼ‘`]/g;

/**
 * Єдине задокументоване правило нормалізації апострофа: усі варіанти → «'» (U+0027).
 * Літери і, ї, є, ґ не чіпаються ніколи.
 */
export function normalizeApostrophes(str) {
  return str.replace(APOSTROPHES, "'");
}

/** Нормалізація токена словника: Unicode NFC, нижній регістр, апостроф. */
export function normalizeToken(raw) {
  return normalizeApostrophes(raw.normalize('NFC').toLowerCase());
}

/** Нормалізація одного набраного символу перед порівнянням з еталоном. */
export function normalizeTypedChar(ch) {
  return normalizeApostrophes(ch.normalize('NFC'));
}

export function wordPattern(lang) {
  const letters = ALPHABETS[lang];
  // Слово: літери мови, усередині дозволені апостроф і (для української) дефіс.
  const inner = lang === 'uk' ? "'-" : "'";
  return new RegExp(`^[${letters}]+(?:[${inner}][${letters}]+)*$`, 'u');
}

export function isLetter(ch, lang) {
  return ALPHABETS[lang].includes(ch.toLowerCase());
}

/** До якої мови належить літера: 'en', 'uk' або null (цифра, знак, пробіл). */
export function scriptOf(ch) {
  const lower = ch.toLowerCase();
  if (ALPHABETS.en.includes(lower)) return 'en';
  if (ALPHABETS.uk.includes(lower)) return 'uk';
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'uk';
  if (/\p{Script=Latin}/u.test(ch)) return 'en';
  return null;
}

/** Послідовні літерні n-грами слова (апостроф і дефіс розривають n-граму). */
export function ngramsOf(word, n, lang) {
  const out = [];
  for (let i = 0; i + n <= word.length; i += 1) {
    const gram = word.slice(i, i + n);
    let ok = true;
    for (const ch of gram) if (!isLetter(ch, lang)) ok = false;
    if (ok) out.push(gram);
  }
  return out;
}

export function uniqueChars(str) {
  return [...new Set(str)];
}
