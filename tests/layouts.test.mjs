// ТЗ §2, §8.4: кожна підтримувана клавіша має рівно одне призначення пальця.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINGERS, HOME_ROW, KEYS, LAYOUTS, describeKey, fingerOf, homeCharOf, keyInfo, shiftFingerFor, transitionKind } from '../src/core/layouts.js';
import { ALPHABETS } from '../src/core/text.js';
import { describeWord } from '../src/core/word-info.js';

const SPEC = {
  en: { L5: 'qaz', L4: 'wsx', L3: 'edc', L2: 'rfvtgb', R2: 'yhnujm', R3: 'ik,', R4: 'ol.', R5: "p[];'/" },
  uk: { L5: 'йфя', L4: 'ціч', L3: 'увс', L2: 'кеапми', R2: 'нгроть', R3: 'шлб', R4: 'щдю', R5: 'зхїжє.' },
};

test('кожна фізична клавіша закріплена рівно за одним пальцем', () => {
  for (const [code, key] of Object.entries(KEYS)) {
    assert.equal(typeof key.finger, 'string', code);
    assert.ok(FINGERS[key.finger], `${code}: невідомий палець`);
  }
});

test('кожен символ розкладки набирається рівно однією клавішею і одним пальцем', () => {
  for (const lang of ['en', 'uk']) {
    for (const [ch, entry] of Object.entries(LAYOUTS[lang].chars)) {
      assert.ok(KEYS[entry.code], `${lang} «${ch}»: немає клавіші`);
      assert.equal(fingerOf(ch, lang), KEYS[entry.code].finger);
    }
  }
});

test('розподіл пальців збігається з таблицями ТЗ (QWERTY і ЙЦУКЕН)', () => {
  for (const lang of ['en', 'uk']) {
    for (const [finger, chars] of Object.entries(SPEC[lang])) {
      for (const ch of chars) assert.equal(fingerOf(ch, lang), finger, `${lang} «${ch}»`);
    }
  }
});

test('усі літери обох абеток підтримуються, разом з і, ї, є, ґ та апострофом', () => {
  for (const lang of ['en', 'uk']) {
    for (const ch of ALPHABETS[lang]) {
      assert.ok(keyInfo(ch, lang), `${lang} «${ch}»`);
      assert.ok(keyInfo(ch.toUpperCase(), lang), `${lang} «${ch.toUpperCase()}»`);
    }
  }
  for (const ch of "іїєґ'") assert.ok(keyInfo(ch, 'uk'), ch);
  assert.equal(keyInfo('ґ', 'uk').altGr, true);
  assert.equal(keyInfo('г', 'uk').altGr, false, '«ґ» і «г» — різні комбінації');
});

test('домашній ряд: ASDF JKL; і ФІВА ОЛДЖ, пробіл — великий палець', () => {
  assert.deepEqual(HOME_ROW.en, { left: 'asdf', right: 'jkl;' });
  assert.deepEqual(HOME_ROW.uk, { left: 'фіва', right: 'олдж' });
  for (const lang of ['en', 'uk']) {
    for (const ch of HOME_ROW[lang].left + HOME_ROW[lang].right) {
      assert.equal(keyInfo(ch, lang).row, 2);
      assert.equal(homeCharOf(ch, lang), ch);
    }
    assert.equal(fingerOf(' ', lang), 'T');
  }
  assert.equal(homeCharOf('t', 'en'), 'f');
  assert.equal(homeCharOf('ь', 'uk'), 'о');
});

test('Shift натискає мізинець протилежної руки', () => {
  assert.equal(shiftFingerFor('F', 'en'), 'R5');
  assert.equal(shiftFingerFor('J', 'en'), 'L5');
  assert.equal(shiftFingerFor('А', 'uk'), 'R5');
  assert.equal(shiftFingerFor('a', 'en'), null);
  assert.match(describeKey('J', 'en'), /Shift — лівий мізинець/);
});

test('класифікація переходів', () => {
  assert.equal(transitionKind('e', 'd', 'en'), 'sameFinger');
  assert.equal(transitionKind('l', 'l', 'en'), 'sameKey');
  assert.equal(transitionKind('t', 'h', 'en'), 'alternate');
  assert.equal(transitionKind('e', 'r', 'en'), 'roll');
  assert.equal(transitionKind('р', 'о', 'uk'), 'sameFinger');
});

test('опис слова за схемою ТЗ §5.3 відтворюється з компактного запису', () => {
  const info = describeWord('навчання', 'uk', 12345);
  assert.deepEqual(info.characters, ['н', 'а', 'в', 'ч', 'а', 'н', 'н', 'я']);
  assert.deepEqual(info.bigrams, ['на', 'ав', 'вч', 'ча', 'ан', 'нн', 'ня']);
  assert.equal(info.language, 'uk');
  assert.equal(info.frequency, 12345);
  assert.equal(info.difficulty.length, 8);
  assert.equal(typeof info.difficulty.sameFingerTransitions, 'number');
  assert.equal(typeof info.difficulty.rowChanges, 'number');
  assert.deepEqual(describeWord("м'яч", 'uk').flags, ['apostrophe']);
});
