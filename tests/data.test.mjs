// ТЗ §8.6–§8.8: кодування словників, контрольні суми сировини, відтворюваність обробки.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SOURCES, buildAll } from '../scripts/build-data.mjs';
import { buildCurriculum } from '../scripts/build-curriculum.mjs';
import { verifyChecksums } from '../scripts/checksums.mjs';
import { Hunspell } from '../scripts/lib/hunspell.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const json = (path) => JSON.parse(read(path).toString('utf8'));

test('ТЗ §8.7: контрольні суми незмінної сировини збігаються з маніфестом', () => {
  const result = verifyChecksums();
  assert.deepEqual(result.problems, []);
  assert.ok(result.files >= 16);
});

test('кожен набір у маніфесті має джерело, зафіксовану ревізію, ліцензію і файл ліцензії', () => {
  const manifest = json('dictionaries/manifest.json');
  for (const dataset of manifest.datasets) {
    assert.match(dataset.source, /^https:\/\/github\.com\//, dataset.id);
    assert.match(dataset.revision, /^[0-9a-f]{40}$/, dataset.id);
    assert.ok(dataset.license.length >= 3, dataset.id);
    assert.ok(read(`dictionaries/${dataset.licenseFile}`).length > 500, `${dataset.id}: файл ліцензії`);
    assert.ok(dataset.files.some((file) => file.path === dataset.licenseFile), `${dataset.id}: ліцензія під контрольною сумою`);
  }
});

test('ТЗ §8.6: вхідні словники читаються як коректний UTF-8', () => {
  const strict = new TextDecoder('utf-8', { fatal: true });
  for (const lang of ['en', 'uk']) {
    for (const key of ['frequency', 'aff', 'dic']) {
      const text = strict.decode(read(SOURCES[lang][key])); // кидає виняток на некоректних байтах
      assert.equal(text.includes('�'), false, SOURCES[lang][key]);
    }
  }
  const frequency = strict.decode(read(SOURCES.uk.frequency));
  assert.ok(frequency.startsWith('я '), 'перше слово українського списку читається кирилицею');
  for (const word of ['що', 'їх', 'є', 'життя']) assert.ok(new RegExp(`^${word} \\d+$`, 'm').test(frequency), word);
  const dic = strict.decode(read(SOURCES.uk.dic));
  for (const word of ["м'яч", 'ґрунт', 'їжак', 'єдність']) assert.ok(dic.includes(`\n${word}/`), word);
});

test('перевірка Hunspell: словоформи приймаються, власні назви й російські слова — ні', () => {
  const uk = new Hunspell(read(SOURCES.uk.aff).toString('utf8'), read(SOURCES.uk.dic).toString('utf8'));
  for (const word of ['книжками', 'зробив', 'найкращий', "м'яч", 'будь-який', 'ґрунт', 'їжака']) assert.equal(uk.check(word), true, word);
  for (const word of ['что', 'ты', 'сегодня', 'книжкаа', 'qwerty']) assert.equal(uk.check(word), false, word);
  const en = new Hunspell(read(SOURCES.en.aff).toString('utf8'), read(SOURCES.en.dic).toString('utf8'));
  for (const word of ['walked', 'cities', 'happier', 'unhappy', "don't", 'is']) assert.equal(en.check(word), true, word);
  for (const word of ['london', 'jordan', 'asdf', 'dont']) assert.equal(en.check(word), false, word);
});

test('ТЗ §8.8: повторний запуск обробки дає ті самі байти, що лежать у репозиторії', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gamy-derived-'));
  try {
    const report = buildAll(dir);
    for (const lang of ['en', 'uk']) {
      for (const [path, hash] of Object.entries(report.languages[lang].outputs)) {
        const committed = sha256(read(path));
        assert.equal(hash, committed, `${path}: закомічений файл відрізняється від щойно зібраного`);
        assert.equal(sha256(readFileSync(join(dir, lang, path.split('/').at(-1)))), committed);
      }
    }
    assert.equal(sha256(readFileSync(join(dir, 'build-report.json'))), sha256(read('data/derived/build-report.json')));
    // Другий запуск у той самий каталог нічого не змінює.
    const again = buildAll(dir);
    assert.deepEqual(again, report);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ТЗ §8.8: навчальна програма відтворюється побайтно', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gamy-curriculum-'));
  try {
    buildCurriculum(dir);
    for (const lang of ['en', 'uk']) {
      assert.equal(sha256(readFileSync(join(dir, `${lang}.json`))), sha256(read(`data/curriculum/${lang}.json`)), `data/curriculum/${lang}.json`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('похідні словники: формат, порядок, фільтри', () => {
  const report = json('data/derived/build-report.json');
  for (const lang of ['en', 'uk']) {
    const data = json(`data/derived/${lang}/words.json`);
    assert.equal(data.language, lang);
    assert.ok(data.words.length >= 10000);
    for (let i = 1; i < data.words.length; i += 1) assert.ok(data.words[i - 1][1] >= data.words[i][1], 'за спаданням частоти');
    assert.equal(new Set(data.words.map(([word]) => word)).size, data.words.length, 'без дублікатів');
    const steps = report.languages[lang].steps;
    assert.ok(steps[0].records === 50000 && steps.at(-2).records === data.words.length);
    for (const [word] of data.words) {
      assert.equal(word, word.normalize('NFC').toLowerCase());
      assert.equal(/[’ʼ`]/.test(word), false, `ненормалізований апостроф у «${word}»`);
    }
  }
});

test('український словник: без російських літер і слів, і/ї/є/ґ збережено', () => {
  const data = json('data/derived/uk/words.json');
  const words = new Set(data.words.map(([word]) => word));
  for (const [word] of data.words) assert.equal(/[ыэъёa-z]/.test(word), false, word);
  for (const word of ['что', 'это', 'он', 'мне', 'его', 'конечно', 'потом', 'после', 'ладно']) assert.equal(words.has(word), false, `російське «${word}»`);
  for (const word of ['що', 'він', 'її', 'їх', 'є', 'життя', 'сьогодні', 'дякую', 'єдиний']) assert.equal(words.has(word), true, word);
  assert.ok(data.supplement.some((word) => word.includes('ґ')) && data.supplement.some((word) => word.includes("'")));
  assert.equal(data.license, 'GPL-3.0-or-later');
});

test('n-грами: вага дорівнює сумі частот слів із цією n-грамою', () => {
  for (const lang of ['en', 'uk']) {
    const { words } = json(`data/derived/${lang}/words.json`);
    const ngrams = json(`data/derived/${lang}/ngrams.json`);
    for (const entry of [ngrams.bigrams[0], ngrams.bigrams[7], ngrams.trigrams[0], ngrams.trigrams[5]]) {
      const expected = words.filter(([word]) => word.includes(entry.gram)).reduce((sum, [, freq]) => sum + freq, 0);
      assert.equal(entry.weight, expected, `${lang} «${entry.gram}»`);
      assert.ok(entry.words.every((word) => word.includes(entry.gram)));
    }
    for (let i = 1; i < ngrams.bigrams.length; i += 1) assert.ok(ngrams.bigrams[i - 1].weight >= ngrams.bigrams[i].weight);
  }
});
