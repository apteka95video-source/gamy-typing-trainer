// ТЗ §3, §8.3: три етапи обома мовами; вправа другого етапу не містить невідкритих символів.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HOME_ROW, isSupportedChar } from '../src/core/layouts.js';
import { flattenCourse } from '../src/core/progress.js';
import { isLetter } from '../src/core/text.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const curricula = { en: load('data/curriculum/en.json'), uk: load('data/curriculum/uk.json') };
const dictionaries = { en: load('data/derived/en/words.json'), uk: load('data/derived/uk/words.json') };

/** Слова тексту без розділових знаків на краях (апостроф і дефіс усередині слова лишаються). */
function wordsOf(text, lang) {
  return text.split(' ')
    .map((token) => {
      const chars = [...token];
      while (chars.length && !isLetter(chars[0], lang)) chars.shift();
      while (chars.length && !isLetter(chars.at(-1), lang)) chars.pop();
      return chars.join('');
    })
    .filter(Boolean);
}

for (const lang of ['en', 'uk']) {
  const curriculum = curricula[lang];
  const course = flattenCourse(curriculum);
  const known = new Set([...dictionaries[lang].words.map(([word]) => word), ...dictionaries[lang].supplement]);

  test(`[${lang}] є всі три етапи, і кожен урок відкриває нові клавіші поступово`, () => {
    for (const stage of [1, 2, 3]) assert.ok(course.some((exercise) => exercise.stage === stage), `етап ${stage}`);
    let previous = ' ';
    for (const lesson of curriculum.lessons) {
      assert.ok(lesson.opened.startsWith(previous), `${lesson.id}: відкриті клавіші лише додаються`);
      assert.ok(lesson.opened.length - previous.length <= 40);
      previous = lesson.opened;
    }
    const firstKeys = curriculum.lessons.filter((lesson) => lesson.kind === 'keys');
    assert.ok(firstKeys.every((lesson) => lesson.newKeys.length <= 3), 'за урок відкривається не більше трьох клавіш');
  });

  test(`[${lang}] перші уроки — домашній ряд`, () => {
    const home = HOME_ROW[lang].left + HOME_ROW[lang].right;
    const firstFour = curriculum.lessons.slice(0, 4).flatMap((lesson) => lesson.newKeys).join('');
    assert.deepEqual([...firstFour].sort(), [...home].sort());
    const scales = curriculum.lessons[4].exercises.map((exercise) => exercise.texts[0]).join(' ');
    assert.ok(scales.includes(`${HOME_ROW[lang].left} ${HOME_ROW[lang].right}`), 'є гама зліва направо');
    assert.ok(scales.includes([...HOME_ROW[lang].right].reverse().join('')), 'є гама справа наліво');
  });

  test(`[${lang}] ідентифікатори вправ унікальні, кожна вправа має мету й текст`, () => {
    const ids = course.map((exercise) => exercise.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const exercise of course) {
      assert.ok(exercise.title && exercise.goal.length > 20, exercise.id);
      assert.ok(exercise.texts.length >= 1, exercise.id);
      for (const text of exercise.texts) {
        assert.ok(text.length >= 20 && text.length <= 320, `${exercise.id}: довжина ${text.length}`);
        assert.equal(text, text.trim());
        assert.ok(!text.includes('  '), `${exercise.id}: подвійний пробіл`);
      }
    }
  });

  test(`[${lang}] кожен символ кожної вправи є в розкладці (його можна набрати)`, () => {
    for (const exercise of course) {
      for (const text of exercise.texts) {
        for (const ch of text) assert.ok(isSupportedChar(ch, lang), `${exercise.id}: символ «${ch}»`);
      }
    }
  });

  test(`[${lang}] ТЗ §8.3: вправи етапів 1 і 2 містять лише відкриті символи (усі варіанти)`, () => {
    let checked = 0;
    for (const lesson of curriculum.lessons) {
      const opened = new Set(lesson.opened);
      for (const exercise of lesson.exercises) {
        for (const text of exercise.texts) {
          for (const ch of text) {
            assert.ok(opened.has(ch), `${exercise.id}: символ «${ch}» ще не відкрито в уроці ${lesson.n}`);
          }
          checked += 1;
        }
      }
    }
    assert.ok(checked > 150);
  });

  test(`[${lang}] етап 2 складається зі справжніх слів словника`, () => {
    let words = 0;
    for (const exercise of course.filter((item) => item.stage === 2 && item.kind !== 'words-numbers')) {
      for (const text of exercise.texts) {
        for (const word of wordsOf(text, lang)) {
          assert.ok(known.has(word.toLowerCase()), `${exercise.id}: «${word}» немає в словнику`);
          words += 1;
        }
      }
    }
    assert.ok(words > 1000, `перевірено слів: ${words}`);
  });

  test(`[${lang}] етап 1 позначено як механіку, етапи 2 і 3 — ні`, () => {
    for (const exercise of course) assert.equal(exercise.mechanical, exercise.stage === 1, exercise.id);
  });

  test(`[${lang}] Академія: видимі модулі з критерієм, n-грамні вправи містять свою n-граму`, () => {
    assert.ok(curriculum.academy.length >= 8);
    for (const module of curriculum.academy) {
      assert.ok(module.description.length > 20 && module.criterion.length > 10, module.id);
      assert.ok(module.exercises.length >= 4, module.id);
      for (const exercise of module.exercises) {
        assert.equal(exercise.stage, 3);
        if (!exercise.ngram) continue;
        assert.ok(exercise.share > 0, exercise.id);
        for (const text of exercise.texts) {
          const hits = text.split(' ').filter((word) => word.includes(exercise.ngram)).length;
          assert.ok(hits >= 6, `${exercise.id}: «${exercise.ngram}» трапляється лише ${hits} разів`);
        }
      }
    }
    const kinds = new Set(curriculum.academy.flatMap((module) => module.exercises.map((exercise) => exercise.kind)));
    for (const kind of ['ngram', 'morpheme', 'alternate', 'punctuation', 'numbers', 'sentences', 'paragraph', 'tempo']) {
      assert.ok(kinds.has(kind), `немає вправ типу ${kind}`);
    }
  });

  test(`[${lang}] темп вимагається лише в модулі темпових серій`, () => {
    const tempo = course.filter((exercise) => exercise.tempo);
    assert.ok(tempo.length >= 4);
    assert.ok(tempo.every((exercise) => exercise.stage === 3 && exercise.kind === 'tempo'));
  });
}

test('[uk] курс містить і, ї, є, ґ та апостроф; жодна з літер не замінена', () => {
  const all = flattenCourse(curricula.uk).flatMap((exercise) => exercise.texts).join(' ');
  for (const ch of "іїєґ'ІЇЄҐ") assert.ok(all.includes(ch), `немає «${ch}»`);
  // Латинські двійники українських літер у текстах не трапляються.
  assert.equal(/[a-zA-Z]/.test(all), false);
  const special = curricula.uk.lessons.flatMap((lesson) => lesson.exercises).find((exercise) => exercise.kind === 'words-ukrainian');
  assert.ok(special, 'є окрема вправа на ґ, є, ї, і');
  const apostrophe = curricula.uk.lessons.flatMap((lesson) => lesson.exercises).find((exercise) => exercise.kind === 'words-apostrophe');
  assert.ok(apostrophe.texts.every((text) => text.includes("'")));
});

test('[en] курс не містить кирилиці', () => {
  const all = flattenCourse(curricula.en).flatMap((exercise) => exercise.texts).join(' ');
  assert.equal(/\p{Script=Cyrillic}/u.test(all), false);
});
