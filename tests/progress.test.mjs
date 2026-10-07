// Навчальний шлях, залік, збереження між сеансами (ТЗ §8.9), аналітика й адаптивні вправи.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildWeakDrill } from '../src/core/adaptive.js';
import { analyzeAttempt, emptyStats, recommend, updateStats, weakSpots } from '../src/core/analysis.js';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../src/core/config.js';
import { TypingSession } from '../src/core/engine.js';
import { judgeAttempt } from '../src/core/metrics.js';
import { emptyProgress, flattenCourse, isUnlocked, nextExercise, openedChars, recordAttempt, thresholdsFor } from '../src/core/progress.js';
import { addHistory, createProfile, exportProfile, importProfile, loadProfile, sanitizeProfile, saveProfile } from '../src/core/storage.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const curriculum = load('data/curriculum/uk.json');
const course = flattenCourse(curriculum);
const words = load('data/derived/uk/words.json').words;

/** Сховище з інтерфейсом localStorage: дані переживають «перезавантаження», якщо передати той самий об'єкт. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function attempt(exercise, { errors = 0, step = 250 } = {}) {
  const session = new TypingSession(exercise.texts[0], { lang: 'uk' });
  let t = 0;
  [...exercise.texts[0]].forEach((ch, i) => {
    if (i > 0 && i <= errors) { session.input('~', t); t += step; }
    session.input(ch, t);
    t += step;
  });
  const metrics = session.metrics();
  return { session, metrics, verdict: judgeAttempt(metrics, thresholdsFor(exercise, DEFAULT_SETTINGS)) };
}

test('спочатку відкрита лише перша вправа; наступна відкривається після заліку', () => {
  const progress = emptyProgress();
  assert.equal(nextExercise(course, progress).id, course[0].id);
  assert.equal(isUnlocked(course, progress, course[0].id), true);
  assert.equal(isUnlocked(course, progress, course[1].id), false);
  assert.equal(isUnlocked(course, progress, course.at(-1).id), false);
  assert.equal(isUnlocked(course, progress, course.at(-1).id, true), true, 'вільний доступ відкриває все');
});

test('вправу завершено після трьох успішних спроб поспіль; невдала спроба обнуляє серію', () => {
  const progress = emptyProgress();
  const exercise = course[0];
  const good = attempt(exercise);
  const bad = attempt(exercise, { errors: 6 });
  assert.equal(good.verdict.passed, true);
  assert.equal(bad.verdict.passed, false);

  assert.equal(recordAttempt(progress, exercise, good.metrics, good.verdict, DEFAULT_SETTINGS).streak, 1);
  assert.equal(recordAttempt(progress, exercise, good.metrics, good.verdict, DEFAULT_SETTINGS).streak, 2);
  const reset = recordAttempt(progress, exercise, bad.metrics, bad.verdict, DEFAULT_SETTINGS);
  assert.equal(reset.streak, 0);
  assert.equal(reset.passed, false);
  assert.equal(isUnlocked(course, progress, course[1].id), false);

  recordAttempt(progress, exercise, good.metrics, good.verdict, DEFAULT_SETTINGS);
  recordAttempt(progress, exercise, good.metrics, good.verdict, DEFAULT_SETTINGS);
  const done = recordAttempt(progress, exercise, good.metrics, good.verdict, DEFAULT_SETTINGS);
  assert.equal(done.justPassed, true);
  assert.equal(done.attempts, 6);
  assert.equal(isUnlocked(course, progress, course[1].id), true);
  assert.equal(nextExercise(course, progress).id, course[1].id);
});

test('пороги заліку беруться з налаштувань; темп потрібен лише темповим серіям', () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.minAccuracy[1] = 98;
  settings.tempoTargetSpm = 200;
  assert.deepEqual(thresholdsFor(course[0], settings), { minAccuracy: 98, targetSpm: null, streakToPass: 3 });
  const tempo = course.find((exercise) => exercise.tempo);
  assert.equal(thresholdsFor(tempo, settings).targetSpm, 200);
});

test('клавіші уроку стають відкритими для слів лише після його гам', () => {
  const progress = emptyProgress();
  assert.equal(openedChars(curriculum, course, progress), ' ');
  const lesson = curriculum.lessons[0];
  for (const exercise of lesson.exercises.filter((item) => item.stage === 1)) progress.exercises[exercise.id] = { passed: true };
  assert.equal(openedChars(curriculum, course, progress), lesson.opened);
  assert.equal(openedChars(curriculum, course, progress, true), curriculum.lessons.at(-1).opened);
});

test('ТЗ §8.9: після перезавантаження зберігаються відкриті уроки та особисті результати', () => {
  const storage = new MemoryStorage();
  const profile = loadProfile(storage);
  assert.equal(profile.onboarded.uk, false, 'новий профіль');

  profile.onboarded.uk = true;
  const exercise = course[0];
  const good = attempt(exercise);
  for (let i = 0; i < 3; i += 1) recordAttempt(profile.progress.uk, exercise, good.metrics, good.verdict, profile.settings);
  updateStats(profile.stats.uk, good.session);
  addHistory(profile, { t: '2026-10-07T10:00:00.000Z', lang: 'uk', id: exercise.id, title: exercise.title, stage: 1, spm: good.metrics.spm, accuracy: good.metrics.accuracy, errors: 0, ms: good.metrics.elapsedMs, passed: true });
  profile.settings.fontSize = 32;
  assert.equal(saveProfile(storage, profile), true);

  // «Перезавантаження»: новий об'єкт профілю з того самого сховища.
  const reloaded = loadProfile(storage);
  assert.notEqual(reloaded, profile);
  assert.equal(reloaded.onboarded.uk, true);
  assert.equal(reloaded.progress.uk.exercises[exercise.id].passed, true);
  assert.equal(reloaded.progress.uk.exercises[exercise.id].attempts, 3);
  assert.equal(reloaded.progress.uk.exercises[exercise.id].bestSpm, good.metrics.spm);
  assert.equal(isUnlocked(course, reloaded.progress.uk, course[1].id), true, 'відкритий урок лишився відкритим');
  assert.equal(reloaded.history.length, 1);
  assert.equal(reloaded.history[0].passed, true);
  assert.equal(reloaded.settings.fontSize, 32);
  assert.ok(reloaded.stats.uk.keys['а'].n > 0);
});

test('зіпсовані або чужі дані у сховищі не ламають застосунок', () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  assert.equal(loadProfile(storage).version, 1);
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, lang: 'xx', settings: { minAccuracy: { 1: 5 }, streakToPass: 99, fontSize: 'big', theme: 'pink' }, history: 'oops' }));
  const profile = loadProfile(storage);
  assert.equal(profile.lang, 'uk');
  assert.equal(profile.settings.minAccuracy[1], 90, 'поріг точності не можна опустити нижче 90 %');
  assert.equal(profile.settings.streakToPass, 5);
  assert.equal(profile.settings.fontSize, 20);
  assert.equal(profile.settings.theme, 'auto');
  assert.deepEqual(profile.history, []);
  assert.equal(saveProfile({ setItem() { throw new Error('quota'); } }, profile), false, 'помилка сховища не кидає виняток');
});

test('експорт та імпорт профілю', () => {
  const profile = createProfile();
  profile.lang = 'en';
  profile.progress.en.exercises['en-l01-s1-01'] = { attempts: 3, streak: 3, passed: true, bestSpm: 120, bestAccuracy: 100, lastSpm: 120, lastAccuracy: 100, variant: 0 };
  const restored = importProfile(exportProfile(profile));
  assert.deepEqual(restored, sanitizeProfile(profile));
  assert.equal(restored.progress.en.exercises['en-l01-s1-01'].passed, true);
  assert.throws(() => importProfile('nope'), /JSON/);
  assert.throws(() => importProfile('{"app":"other"}'), /Гами/);
});

test('рекомендація називає клавішу, на якій справді було найбільше помилок', () => {
  const session = new TypingSession('оло оло оло оло оло', { lang: 'uk' });
  let t = 0;
  for (const ch of session.text) {
    if (ch === 'л') { session.input('д', t); t += 200; }
    session.input(ch, t);
    t += 200;
  }
  const metrics = session.metrics();
  const thresholds = { minAccuracy: 95, targetSpm: null };
  const verdict = judgeAttempt(metrics, thresholds);
  const analysis = analyzeAttempt(session);
  assert.equal(verdict.reason, 'accuracy');
  assert.equal(analysis.errorsByChar[0].ch, 'л');
  assert.deepEqual(analysis.confusions[0], { expected: 'л', typed: 'д', count: 5 });
  const advice = recommend({ session, metrics, verdict, analysis, thresholds, streak: 0, streakToPass: 3, hasNext: true });
  assert.deepEqual(advice.action, { type: 'drill', chars: ['л'], pairs: [] });
  assert.match(advice.text, /«л»/);
  assert.match(advice.text, /правий середній, домашній ряд/);
});

test('рекомендація після розкиданих помилок — знизити темп до конкретного значення', () => {
  const session = new TypingSession('фіва олдж фіва олдж фіва', { lang: 'uk' });
  let t = 0;
  [...session.text].forEach((ch, i) => {
    if ([1, 6, 12, 17].includes(i)) { session.input('я', t); t += 100; }
    session.input(ch, t);
    t += 100;
  });
  const metrics = session.metrics();
  const thresholds = { minAccuracy: 95, targetSpm: null };
  const verdict = judgeAttempt(metrics, thresholds);
  const advice = recommend({ session, metrics, verdict, analysis: analyzeAttempt(session), thresholds, streak: 0, streakToPass: 3, hasNext: true });
  assert.equal(advice.action.type, 'retry');
  assert.match(advice.text, /Знизь темп приблизно до \d+ зн\/хв/);
});

test('слабкі клавіші визначаються за накопиченою статистикою, адаптивна вправа — лише з відкритих символів', () => {
  const stats = emptyStats();
  for (let round = 0; round < 3; round += 1) {
    const session = new TypingSession('ало вода лава діло вдало', { lang: 'uk' });
    let t = 0;
    for (const ch of session.text) {
      if (ch === 'л') { session.input('д', t); t += 200; }
      session.input(ch, t);
      t += ch === 'в' ? 600 : 200;
    }
    updateStats(stats, session);
  }
  const spots = weakSpots(stats, 'uk');
  assert.equal(spots.keys[0].ch, 'л', 'найслабша клавіша — та, де були помилки');
  assert.ok(spots.keys[0].errorRate > 0.4);

  const opened = curriculum.lessons[5].opened; // до «п», «р» включно
  const drill = buildWeakDrill({ lang: 'uk', chars: ['л'], pairs: ['ол'], opened, words, seed: 'test' });
  assert.ok(drill.texts[0].length > 30);
  for (const ch of drill.texts[0]) assert.ok(opened.includes(ch), `символ «${ch}» не відкрито`);
  assert.ok(drill.words.length >= 4 && drill.words.every((word) => word.includes('л')));
  assert.match(drill.goal, /«л»/);
  assert.deepEqual(buildWeakDrill({ lang: 'uk', chars: ['л'], pairs: ['ол'], opened, words, seed: 'test' }), drill, 'однакове зерно — однакова вправа');
  // Клавішу, якої учень ще не відкрив, генератор не використовує.
  assert.equal(buildWeakDrill({ lang: 'uk', chars: ['щ'], pairs: [], opened, words }), null);
});
