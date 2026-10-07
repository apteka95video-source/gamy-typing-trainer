// Автомат набору однієї спроби. Не залежить від DOM і часу: позначки часу передає викликач,
// тому поведінку можна перевіряти тестами на фіксованих прикладах.

import { computeMetrics } from './metrics.js';
import { isLetter, normalizeTypedChar, scriptOf } from './text.js';

export const CHAR_STATE = {
  pending: 'pending',
  correct: 'correct', // правильно з першого разу
  fixed: 'fixed', // правильно, але на цій позиції була помилка
  wrong: 'wrong', // набрано хибний символ і ще не виправлено (режим Backspace)
};

export class TypingSession {
  /**
   * @param {string} text  текст вправи
   * @param {{lang: 'en'|'uk', stopOnError?: boolean}} options
   */
  constructor(text, { lang, stopOnError = true }) {
    this.text = text;
    this.chars = [...text];
    this.lang = lang;
    this.stopOnError = stopOnError;
    this.pos = 0;
    this.states = this.chars.map(() => CHAR_STATE.pending);
    this.hadError = this.chars.map(() => false);
    this.typed = this.chars.map(() => null);
    this.errors = 0;
    this.errorsByChar = new Map(); // очікуваний символ → кількість помилок
    this.confusions = new Map(); // «очікуваний→набраний» → кількість
    this.keystrokes = 0;
    this.firstTs = null;
    this.lastTs = null;
    this.prevTs = null;
    this.prevClean = false; // чи попереднє натискання було чистим влучанням у попередню позицію
    this.allIntervals = [];
    this.cleanIntervals = [];
    this.keyDelays = []; // { ch, ms } — затримка перед чистим натисканням клавіші
    this.pairDelays = []; // { pair, ms } — перехід між двома чистими натисканнями
    this.timeline = []; // { ms, ok } для візуалізації ритму
    this.layoutWarnings = 0;
  }

  get started() {
    return this.firstTs !== null;
  }

  get finished() {
    return this.pos >= this.chars.length;
  }

  get expected() {
    return this.chars[this.pos] ?? null;
  }

  /** Символ іншої розкладки на місці літери (латинка замість кирилиці або навпаки). */
  #isOtherLayout(ch) {
    const expected = this.expected;
    if (!expected || !isLetter(expected, this.lang)) return false;
    const script = scriptOf(ch);
    return script !== null && script !== this.lang;
  }

  #stamp(ts) {
    const interval = this.prevTs === null ? null : ts - this.prevTs;
    if (this.firstTs === null) this.firstTs = ts;
    this.lastTs = ts;
    this.prevTs = ts;
    if (interval !== null) this.allIntervals.push(interval);
    return interval;
  }

  /**
   * Обробляє один набраний символ.
   * @returns {{type: 'correct'|'error'|'layout'|'ignored', expected?: string, typed?: string, done?: boolean}}
   */
  input(rawChar, ts) {
    if (this.finished) return { type: 'ignored' };
    const ch = normalizeTypedChar(rawChar);
    const expected = this.expected;

    // Перевірка розкладки до старту: спроба не починається, помилка не рахується.
    if (!this.started && this.#isOtherLayout(ch)) {
      this.layoutWarnings += 1;
      return { type: 'layout', expected, typed: ch };
    }

    const interval = this.#stamp(ts);
    this.keystrokes += 1;

    if (ch === expected) {
      const clean = !this.hadError[this.pos];
      this.states[this.pos] = clean ? CHAR_STATE.correct : CHAR_STATE.fixed;
      this.typed[this.pos] = null;
      if (clean && interval !== null) {
        this.keyDelays.push({ ch: expected, ms: interval });
        if (this.prevClean && this.pos > 0) {
          this.cleanIntervals.push(interval);
          this.pairDelays.push({ pair: this.chars[this.pos - 1] + expected, ms: interval });
        }
      }
      this.timeline.push({ ms: interval ?? 0, ok: clean });
      this.prevClean = clean;
      this.pos += 1;
      return { type: 'correct', expected, typed: ch, done: this.finished };
    }

    // Помилка: рахується завжди й назавжди, навіть якщо її потім виправлено.
    this.errors += 1;
    this.hadError[this.pos] = true;
    this.errorsByChar.set(expected, (this.errorsByChar.get(expected) ?? 0) + 1);
    const key = `${expected}→${ch}`;
    this.confusions.set(key, (this.confusions.get(key) ?? 0) + 1);
    this.prevClean = false;
    const layout = this.#isOtherLayout(ch);
    if (layout) this.layoutWarnings += 1;

    if (!this.stopOnError) {
      this.states[this.pos] = CHAR_STATE.wrong;
      this.typed[this.pos] = ch;
      this.timeline.push({ ms: interval ?? 0, ok: false });
      this.pos += 1;
      return { type: 'error', expected, typed: ch, layout, done: this.finished };
    }
    return { type: 'error', expected, typed: ch, layout, done: false };
  }

  /** Backspace: повертає на одну позицію (лише в режимі без зупинки на помилці). */
  backspace(ts) {
    if (this.stopOnError || this.finished || this.pos === 0) return { type: 'ignored' };
    this.#stamp(ts);
    this.pos -= 1;
    this.states[this.pos] = CHAR_STATE.pending;
    this.typed[this.pos] = null;
    this.prevClean = false;
    if (this.timeline.length) this.timeline.pop();
    return { type: 'backspace' };
  }

  /** Скільки позицій лишилися з невиправленою помилкою. */
  get uncorrected() {
    return this.states.filter((state) => state === CHAR_STATE.wrong).length;
  }

  metrics() {
    return computeMetrics({
      chars: this.chars.length,
      errors: this.errors,
      elapsedMs: this.started ? this.lastTs - this.firstTs : 0,
      cleanIntervals: this.cleanIntervals,
      allIntervals: this.allIntervals,
    });
  }
}
