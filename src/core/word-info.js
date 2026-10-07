// Повний опис слова за схемою ТЗ (розділ 5.3). У файлах data/derived/ слова зберігаються
// компактно як [слово, частота]; решта полів однозначно відтворюється цією функцією.

import { keyInfo, transitionKind } from './layouts.js';
import { ngramsOf } from './text.js';

const SOURCE_ID = { en: 'frequencywords-2018-en', uk: 'frequencywords-2018-uk' };

export function describeWord(word, lang, frequency = 0) {
  const characters = [...word];
  let sameFingerTransitions = 0;
  let rowChanges = 0;
  for (let i = 1; i < characters.length; i += 1) {
    const a = keyInfo(characters[i - 1], lang);
    const b = keyInfo(characters[i], lang);
    if (!a || !b) continue;
    if (transitionKind(characters[i - 1], characters[i], lang) === 'sameFinger') sameFingerTransitions += 1;
    if (a.row !== b.row) rowChanges += 1;
  }
  const flags = [];
  if (word.includes("'")) flags.push('apostrophe');
  if (word.includes('-')) flags.push('hyphen');
  return {
    word,
    language: lang,
    frequency,
    source: SOURCE_ID[lang],
    characters,
    bigrams: ngramsOf(word, 2, lang),
    difficulty: { length: characters.length, sameFingerTransitions, rowChanges },
    flags,
  };
}
