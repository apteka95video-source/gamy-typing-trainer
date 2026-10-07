// Автомат набору: помилки, виправлення, регістр, апостроф, українські літери, розкладка.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TypingSession } from '../src/core/engine.js';

/** Набирає рядок із кроком 200 мс. */
function type(session, str, start = 0, step = 200) {
  let t = start;
  for (const ch of str) {
    session.input(ch, t);
    t += step;
  }
  return t;
}

test('чиста спроба: N символів, 0 помилок, SPM за першим і останнім натисканням', () => {
  const session = new TypingSession('asdf jkl;', { lang: 'en' });
  type(session, 'asdf jkl;');
  assert.equal(session.finished, true);
  const m = session.metrics();
  assert.equal(m.errors, 0);
  assert.equal(m.accuracy, 100);
  assert.equal(m.elapsedMs, 1600); // 9 символів, 8 інтервалів по 200 мс
  assert.equal(m.spm, (60_000 * 9) / 1600);
});

test('зупинка на помилці: хибна клавіша не просуває курсор і не стає правильним символом', () => {
  const session = new TypingSession('fj', { lang: 'en', stopOnError: true });
  assert.equal(session.input('x', 0).type, 'error');
  assert.equal(session.pos, 0);
  assert.equal(session.input('f', 200).type, 'correct');
  assert.equal(session.states[0], 'fixed', 'позиція з помилкою позначена як виправлена, а не чиста');
  session.input('j', 400);
  assert.equal(session.finished, true);
  assert.equal(session.errors, 1);
});

test('ТЗ §8.2: виправлена помилка входить до статистики (k помилок, k−1 виправлено)', () => {
  const text = 'the quick brown fox jumps over the lazy dog and runs away fast';
  assert.equal(text.length, 62);
  const session = new TypingSession(text, { lang: 'en', stopOnError: false });
  let t = 0;
  const press = (ch) => { session.input(ch, t); t += 150; };
  const fix = () => { session.backspace(t); t += 150; };
  // 3 помилки: дві виправлено клавішею Backspace, третя (остання літера) лишилася.
  [...text].forEach((ch, i) => {
    if (i === 4 || i === 20) { press('#'); fix(); press(ch); } else if (i === text.length - 1) press('#'); else press(ch);
  });
  assert.equal(session.finished, true);
  assert.equal(session.errors, 3, 'лічильник помилок = k');
  assert.equal(session.uncorrected, 1);
  assert.equal(session.metrics().accuracy, ((62 - 3) / 62) * 100);
  assert.equal(session.errorsByChar.get('q'), 1);
});

test('Backspace у режимі зупинки на помилці нічого не робить', () => {
  const session = new TypingSession('ab', { lang: 'en', stopOnError: true });
  session.input('a', 0);
  assert.equal(session.backspace(100).type, 'ignored');
  assert.equal(session.pos, 1);
});

test('регістр перевіряється: мала літера замість великої — помилка', () => {
  const session = new TypingSession('aFj', { lang: 'en' });
  session.input('a', 0);
  assert.equal(session.input('f', 100).type, 'error');
  assert.equal(session.input('F', 200).type, 'correct');
});

test('ТЗ §8.5: і, ї, є, ґ не підміняються іншими символами', () => {
  const pairs = [['і', 'i'], ['і', 'и'], ['ї', 'і'], ['є', 'е'], ['ґ', 'г'], ['і', 'ї']];
  for (const [expected, typed] of pairs) {
    const session = new TypingSession(`о${expected}`, { lang: 'uk' });
    session.input('о', 0);
    assert.equal(session.input(typed, 200).type, 'error', `«${typed}» замість «${expected}» має бути помилкою`);
    assert.equal(session.input(expected, 400).type, 'correct');
    assert.equal(session.errors, 1);
  }
});

test('апостроф нормалізується за задокументованим правилом: варіанти U+2019, U+02BC, U+0060 → U+0027', () => {
  for (const code of [0x27, 0x2019, 0x02bc, 0x60]) {
    const variant = String.fromCodePoint(code);
    const session = new TypingSession("м'яч", { lang: 'uk' });
    type(session, `м${variant}яч`);
    assert.equal(session.finished, true);
    assert.equal(session.errors, 0, `варіант U+${code.toString(16)} має зараховуватися`);
  }
});

test('розкладка перевіряється до старту: латинка в українській вправі не починає спробу й не є помилкою', () => {
  const session = new TypingSession('фіва', { lang: 'uk' });
  assert.equal(session.input('a', 0).type, 'layout');
  assert.equal(session.started, false);
  assert.equal(session.errors, 0);
  session.input('ф', 100);
  // Після старту символ іншої розкладки — звичайна помилка з позначкою.
  const result = session.input('s', 200);
  assert.equal(result.type, 'error');
  assert.equal(result.layout, true);
  assert.equal(session.errors, 1);
});

test('після завершення введення ігнорується', () => {
  const session = new TypingSession('a', { lang: 'en' });
  session.input('a', 0);
  assert.equal(session.input('a', 10).type, 'ignored');
});

test('час переходів записується лише між чистими натисканнями', () => {
  const session = new TypingSession('abcd', { lang: 'en' });
  session.input('a', 0);
  session.input('x', 100); // помилка на «b»
  session.input('b', 300);
  session.input('c', 500);
  session.input('d', 700);
  assert.deepEqual(session.pairDelays.map((p) => p.pair), ['cd'], 'переходи через помилку не потрапляють у статистику швидкості');
  assert.equal(session.keyDelays.some((k) => k.ch === 'b'), false);
});
