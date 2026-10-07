// Адаптивний генератор вправ: добирає рухи та справжні слова під слабкі клавіші й повільні
// переходи конкретного користувача. Обмеження те саме, що й у курсі: лише відкриті символи.

import { describeKey, displayChar, homeCharOf, keyInfo } from './layouts.js';
import { createRng, shuffle } from './rng.js';
import { isLetter } from './text.js';

function allOpened(str, opened) {
  for (const ch of str) if (!opened.has(ch)) return false;
  return true;
}

/** Коротка «гама» для однієї клавіші: домашня → клавіша → домашня. */
export function keyScale(ch, lang, opened) {
  const home = homeCharOf(ch, lang);
  if (!home || !opened.has(ch)) return [];
  if (home === ch || !opened.has(home)) return [ch.repeat(3), ch.repeat(2), ch];
  return [home + ch + home, home + ch + home, ch + home, home + ch];
}

/**
 * Будує вправу на слабкі місця.
 * @param {object} p
 * @param {'en'|'uk'} p.lang
 * @param {string[]} p.chars       слабкі клавіші
 * @param {string[]} p.pairs       повільні переходи (біграми)
 * @param {string} p.opened        усі відкриті символи
 * @param {Array<[string, number]>} p.words  словник мови [слово, частота], за спаданням частоти
 * @param {string} [p.seed]
 */
export function buildWeakDrill({ lang, chars, pairs, opened, words, seed = 'weak' }) {
  const openedSet = new Set(opened);
  const focusChars = chars.filter((ch) => openedSet.has(ch) && keyInfo(ch, lang));
  const focusPairs = pairs.filter((pair) => allOpened(pair, openedSet));
  const rng = createRng(seed);

  const mechanics = [];
  for (const ch of focusChars.slice(0, 3)) mechanics.push(...keyScale(ch, lang, openedSet));
  for (const pair of focusPairs.slice(0, 3)) mechanics.push(pair, pair, pair);

  // Слова: чим більше слабких клавіш і переходів у слові, тим вища оцінка; частота — другий критерій.
  const scored = [];
  const limit = Math.min(words.length, 6000);
  for (let i = 0; i < limit; i += 1) {
    const word = words[i][0];
    if (word.length < 2 || word.length > 10 || !allOpened(word, openedSet)) continue;
    let score = 0;
    for (const ch of focusChars) if (word.includes(ch.toLowerCase())) score += 2;
    for (const pair of focusPairs) if (word.includes(pair)) score += 3;
    if (score === 0) continue;
    scored.push({ word, score: score + (1 - i / limit) });
  }
  scored.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));
  const picked = shuffle(scored.slice(0, 24).map((entry) => entry.word), rng).slice(0, 9);

  const parts = [...mechanics, ...picked];
  if (!parts.length) return null;

  const focusList = [
    ...focusChars.map((ch) => `«${displayChar(ch)}» — ${describeKey(ch, lang)}`),
    ...focusPairs.map((pair) => `перехід «${pair}»`),
  ];
  return {
    id: 'weak',
    stage: 2,
    kind: 'weak',
    mechanical: picked.length === 0,
    title: 'Слабкі місця',
    goal: `Вправу зібрано за твоїми результатами: ${focusList.join('; ')}. Спершу короткі рухи від домашньої клавіші, далі справжні слова лише з відкритих клавіш.`,
    focus: focusChars.join(''),
    texts: [parts.join(' ')],
    words: picked,
  };
}

/** Слабкі клавіші для вправи, якщо статистики ще немає: останні відкриті літери. */
export function fallbackChars(opened, lang, count = 2) {
  return [...opened].filter((ch) => isLetter(ch, lang) && ch === ch.toLowerCase()).slice(-count);
}
