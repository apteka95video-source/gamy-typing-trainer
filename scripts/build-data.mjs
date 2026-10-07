#!/usr/bin/env node
// Відтворювана обробка словників: dictionaries/ (незмінна сировина) → data/derived/.
//
//   node scripts/build-data.mjs            — записати data/derived/
//   node scripts/build-data.mjs --out DIR  — записати в інший каталог (для тесту відтворюваності)
//
// Алгоритм описано в docs/data-sources.md. Скрипт не використовує час, випадковість
// чи мережу, тому повторний запуск на тих самих вхідних файлах дає ті самі байти.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hunspell } from './lib/hunspell.mjs';
import {
  ALPHABETS,
  SINGLE_LETTER_WORDS,
  ngramsOf,
  normalizeToken,
  wordPattern,
} from '../src/core/text.js';

export const ALGORITHM_VERSION = '1.0.0';
export const MAX_WORDS = 12000;
const MAX_WORD_LENGTH = 16;
// Слово відкидається, якщо понад цю частку його вживань пояснюється російськими субтитрами.
export const CONTAMINATION_THRESHOLD = 0.75;
const VOWELS = { en: /[aeiouy]/, uk: /[аеєиіїоуюя]/ };
const RUSSIAN_ONLY_LETTERS = /[ыэъё]/;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCES = {
  en: {
    frequency: 'dictionaries/en/frequencywords-2018/en_50k.txt',
    aff: 'dictionaries/en/hunspell-en/index.aff',
    dic: 'dictionaries/en/hunspell-en/index.dic',
    blocklist: 'data/filters/blocklist-en.txt',
    supplement: 'data/filters/supplement-en.txt',
    license: 'MIT',
  },
  uk: {
    frequency: 'dictionaries/uk/frequencywords-2018/uk_50k.txt',
    aff: 'dictionaries/uk/hunspell-uk/index.aff',
    dic: 'dictionaries/uk/hunspell-uk/index.dic',
    blocklist: 'data/filters/blocklist-uk.txt',
    supplement: 'data/filters/supplement-uk.txt',
    // Російський список — лише «негативний» фільтр: жодне слово з нього не потрапляє у вихідні дані.
    contamination: 'dictionaries/ru/frequencywords-2018/ru_50k.txt',
    license: 'GPL-3.0-or-later',
  },
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readUtf8 = (rel) => {
  const buf = readFileSync(join(ROOT, rel));
  // Словники мають бути UTF-8 без BOM; некоректні байти дали б U+FFFD.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  return { text: text.replace(/^﻿/, ''), sha256: sha256(buf) };
};

function loadBlocklist(text) {
  const exact = new Set();
  const prefixes = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('*')) prefixes.push(line.slice(0, -1));
    else exact.add(line);
  }
  return (word) => exact.has(word) || prefixes.some((p) => word.startsWith(p));
}

function parseFrequency(text) {
  const parsed = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.lastIndexOf(' ');
    const count = Number(trimmed.slice(space + 1));
    if (space <= 0 || !Number.isFinite(count)) continue;
    parsed.push([trimmed.slice(0, space), count]);
  }
  return parsed;
}

function parseList(text) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

/**
 * Український список зібрано із субтитрів, серед яких багато російських. Слова з літерами
 * ы, э, ъ, ё українськими бути не можуть, тому відношення їхніх частот у двох списках дає
 * коефіцієнт k: скільки вживань в «українському» списку припадає на одне вживання в російському.
 * Для кожного слова k·f_ru — очікувана кількість «російських» вживань.
 */
function contaminationModel(ukParsed, ruText) {
  const ru = new Map(parseFrequency(ruText));
  let ukSum = 0;
  let ruSum = 0;
  for (const [word, count] of ukParsed) {
    if (!RUSSIAN_ONLY_LETTERS.test(word) || !ru.has(word)) continue;
    ukSum += count;
    ruSum += ru.get(word);
  }
  const k = ukSum / ruSum;
  return { k, expected: (word) => k * (ru.get(word) ?? 0) };
}

function buildWords(lang) {
  const src = SOURCES[lang];
  const frequency = readUtf8(src.frequency);
  const aff = readUtf8(src.aff);
  const dic = readUtf8(src.dic);
  const blocklist = readUtf8(src.blocklist);

  const speller = new Hunspell(aff.text, dic.text);
  const isBlocked = loadBlocklist(blocklist.text);
  const pattern = wordPattern(lang);
  const singles = new Set(SINGLE_LETTER_WORDS[lang]);
  const steps = [];

  // 1. Розбір рядків «слово кількість».
  let parsed = parseFrequency(frequency.text);
  steps.push({ step: 'parsed', description: 'рядки «слово кількість»', records: parsed.length });

  // 1а. Лише для української: вилучення російських вживань.
  let contamination = null;
  if (src.contamination) {
    contamination = readUtf8(src.contamination);
    const model = contaminationModel(parsed, contamination.text);
    parsed = parsed
      .filter(([word, count]) => model.expected(word) / count <= CONTAMINATION_THRESHOLD)
      .map(([word, count]) => [word, Math.max(1, Math.round(count - model.expected(word)))]);
    steps.push({
      step: 'decontaminated',
      description: `вилучено слова, понад ${CONTAMINATION_THRESHOLD * 100}% вживань яких пояснюється російськими субтитрами (k = ${model.k.toFixed(6)}); частоту решти зменшено на очікувану російську частку`,
      records: parsed.length,
    });
  }

  // 2. Нормалізація (NFC, нижній регістр, апостроф) і злиття дублікатів.
  const merged = new Map();
  for (const [raw, count] of parsed) {
    const word = normalizeToken(raw);
    merged.set(word, (merged.get(word) ?? 0) + count);
  }
  steps.push({ step: 'normalized', description: 'NFC, нижній регістр, апостроф → U+0027, злиття дублікатів', records: merged.size });

  // 3. Дозволений набір символів і довжина.
  let words = [...merged].filter(([word]) => {
    if (word.length > MAX_WORD_LENGTH) return false;
    if (!pattern.test(word)) return false;
    if (/(.)\1\1/u.test(word)) return false; // «ааа», «mmm» — звуконаслідування
    if (word.length === 1) return singles.has(word);
    return VOWELS[lang].test(word); // «hmm», «тсс», скорочення на кшталт «км»
  });
  steps.push({ step: 'charset', description: `лише літери мови (${ALPHABETS[lang]}), апостроф${lang === 'uk' ? ' і дефіс' : ''} всередині слова; довжина 1–${MAX_WORD_LENGTH}; однолітерні — лише справжні слова; є голосна; немає трьох однакових літер поспіль`, records: words.length });

  // 4. Перевірка написання за Hunspell у нижньому регістрі:
  //    власні назви (у словнику з великої літери) та сторонні мови відпадають.
  words = words.filter(([word]) => speller.check(word));
  steps.push({ step: 'spelling', description: 'слово є в Hunspell у нижньому регістрі (відсіює власні назви, помилкові токени, російські слова в українському списку)', records: words.length });

  // 5. Контентний фільтр.
  words = words.filter(([word]) => !isBlocked(word) && !speller.isNoSuggest(word));
  steps.push({ step: 'content', description: 'список data/filters/blocklist-*.txt і прапорець NOSUGGEST', records: words.length });

  // 6. Стабільне сортування і обрізання.
  words.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  words = words.slice(0, MAX_WORDS);
  steps.push({ step: 'top', description: `найчастотніші ${MAX_WORDS} слів`, records: words.length });

  // 7. Доповнювальний список (апостроф, ґ): без частоти, окремим полем.
  const supplementFile = readUtf8(src.supplement);
  const known = new Set(words.map(([word]) => word));
  const supplement = [];
  for (const raw of parseList(supplementFile.text)) {
    const word = normalizeToken(raw);
    if (!pattern.test(word) || !speller.check(word) || isBlocked(word)) {
      throw new Error(`Доповнювальне слово «${raw}» (${lang}) не пройшло перевірку Hunspell або фільтр`);
    }
    if (!known.has(word) && !supplement.includes(word)) supplement.push(word);
  }
  steps.push({ step: 'supplement', description: 'власний список слів з апострофом і ґ, кожне перевірено за Hunspell; зберігається окремо, без частоти', records: supplement.length });

  const inputs = {
    [src.frequency]: frequency.sha256,
    [src.aff]: aff.sha256,
    [src.dic]: dic.sha256,
    [src.blocklist]: blocklist.sha256,
    [src.supplement]: supplementFile.sha256,
  };
  if (contamination) inputs[src.contamination] = contamination.sha256;
  return { words, supplement, steps, inputs };
}

function topEntries(weights, examples, limit, total) {
  return [...weights]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([gram, weight]) => ({
      gram,
      weight,
      share: Number(((weight / total) * 100).toFixed(3)),
      words: examples.get(gram).slice(0, 40),
    }));
}

function buildNgrams(lang, words) {
  // Вага n-грами = сума частот слів, у яких вона трапляється (ТЗ, розділ 3.3).
  const total = words.reduce((sum, [, freq]) => sum + freq, 0);
  const tables = { bigrams: new Map(), trigrams: new Map(), endings: new Map(), prefixes: new Map(), doubles: new Map() };
  const examples = { bigrams: new Map(), trigrams: new Map(), endings: new Map(), prefixes: new Map(), doubles: new Map() };
  const add = (table, gram, word, freq) => {
    tables[table].set(gram, (tables[table].get(gram) ?? 0) + freq);
    if (!examples[table].has(gram)) examples[table].set(gram, []);
    examples[table].get(gram).push(word); // слова вже впорядковані за частотою
  };
  const letters = ALPHABETS[lang];
  const allLetters = (s) => [...s].every((ch) => letters.includes(ch));

  for (const [word, freq] of words) {
    for (const gram of new Set(ngramsOf(word, 2, lang))) {
      add('bigrams', gram, word, freq);
      if (gram[0] === gram[1]) add('doubles', gram, word, freq);
    }
    for (const gram of new Set(ngramsOf(word, 3, lang))) add('trigrams', gram, word, freq);
    for (const len of [2, 3, 4]) {
      // Закінчення і початки рахуємо лише для слів, довших за саму морфему щонайменше на 2 літери.
      if (word.length < len + 2) continue;
      const ending = word.slice(-len);
      if (allLetters(ending)) add('endings', ending, word, freq);
      if (len < 4) {
        const prefix = word.slice(0, len);
        if (allLetters(prefix)) add('prefixes', prefix, word, freq);
      }
    }
  }

  return {
    totalWeight: total,
    bigrams: topEntries(tables.bigrams, examples.bigrams, 80, total),
    trigrams: topEntries(tables.trigrams, examples.trigrams, 60, total),
    endings: topEntries(tables.endings, examples.endings, 60, total),
    prefixes: topEntries(tables.prefixes, examples.prefixes, 40, total),
    doubles: topEntries(tables.doubles, examples.doubles, 20, total),
  };
}

const stringify = (value) => `${JSON.stringify(value)}\n`;

export function buildAll(outDir = join(ROOT, 'data/derived')) {
  const report = { algorithmVersion: ALGORITHM_VERSION, languages: {} };
  for (const lang of ['en', 'uk']) {
    const { words, supplement, steps, inputs } = buildWords(lang);
    const ngrams = buildNgrams(lang, words);
    const header = {
      schema: 1,
      language: lang,
      algorithmVersion: ALGORITHM_VERSION,
      license: SOURCES[lang].license,
      sources: Object.keys(inputs),
    };
    const wordsJson = stringify({ ...header, format: '[слово, частота]', words, supplement });
    const ngramsJson = stringify({ ...header, ...ngrams });
    mkdirSync(join(outDir, lang), { recursive: true });
    writeFileSync(join(outDir, lang, 'words.json'), wordsJson);
    writeFileSync(join(outDir, lang, 'ngrams.json'), ngramsJson);
    report.languages[lang] = {
      license: SOURCES[lang].license,
      inputs,
      steps,
      outputs: {
        [`data/derived/${lang}/words.json`]: sha256(Buffer.from(wordsJson)),
        [`data/derived/${lang}/ngrams.json`]: sha256(Buffer.from(ngramsJson)),
      },
    };
  }
  writeFileSync(join(outDir, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  const outDir = outFlag === -1 ? undefined : resolve(process.argv[outFlag + 1]);
  const report = buildAll(outDir);
  for (const [lang, info] of Object.entries(report.languages)) {
    console.log(`[${lang}] ${info.steps.map((s) => `${s.step}: ${s.records}`).join(' → ')}`);
  }
}
