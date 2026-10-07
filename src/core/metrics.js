// Метрики спроби. Формули зафіксовані тут і перевіряються тестами на фіксованих прикладах.
//
//   SPM (знаків за хвилину) = 60 · N / T
//       N — кількість символів вправи, T — секунди від першого до останнього натискання.
//   Точність = (N − E) / N · 100 %
//       E — усі помилкові натискання, включно з виправленими.
//   WPM = SPM / 5 (додаткова метрика).
//   Нерівномірність ритму = σ / μ інтервалів між чистими натисканнями · 100 %.

import { PLAUSIBILITY } from './config.js';

export function computeSpm(chars, elapsedMs) {
  if (!(elapsedMs > 0) || chars <= 0) return 0;
  return (60000 * chars) / elapsedMs;
}

export function computeAccuracy(chars, errors) {
  if (chars <= 0) return 0;
  return Math.max(0, ((chars - errors) / chars) * 100);
}

export function computeWpm(spm) {
  return spm / 5;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Коефіцієнт варіації інтервалів, %: 0 — ідеально рівний ритм. */
export function rhythmUnevenness(intervals) {
  if (intervals.length < 2) return 0;
  const mu = mean(intervals);
  if (mu <= 0) return 0;
  const variance = mean(intervals.map((v) => (v - mu) ** 2));
  return (Math.sqrt(variance) / mu) * 100;
}

/**
 * Чи правдоподібна спроба для людини. Усі інтервали між натисканнями
 * (а не лише чисті) беруть участь у перевірці.
 */
export function plausibility(chars, elapsedMs, allIntervals) {
  if (chars < PLAUSIBILITY.minChars) return { ok: true, reason: null };
  if (computeSpm(chars, elapsedMs) > PLAUSIBILITY.maxSpm) return { ok: false, reason: 'too-fast' };
  if (allIntervals.length >= 4 && median(allIntervals) < PLAUSIBILITY.minMedianIntervalMs) {
    return { ok: false, reason: 'too-fast' };
  }
  return { ok: true, reason: null };
}

/** Зведені метрики завершеної спроби. */
export function computeMetrics({ chars, errors, elapsedMs, cleanIntervals = [], allIntervals = [] }) {
  const spm = computeSpm(chars, elapsedMs);
  return {
    chars,
    errors,
    elapsedMs,
    spm,
    wpm: computeWpm(spm),
    accuracy: computeAccuracy(chars, errors),
    unevenness: rhythmUnevenness(cleanIntervals),
    plausibility: plausibility(chars, elapsedMs, allIntervals),
  };
}

/**
 * Рішення про залік. Швидкість ніколи не зараховує вправу без точності:
 * спершу перевіряється точність, і лише для темпових серій — додатково швидкість.
 */
export function judgeAttempt(metrics, { minAccuracy, targetSpm = null }) {
  if (!metrics.plausibility.ok) return { passed: false, reason: 'implausible' };
  if (metrics.accuracy < minAccuracy) return { passed: false, reason: 'accuracy' };
  if (targetSpm !== null && metrics.spm < targetSpm) return { passed: false, reason: 'tempo' };
  return { passed: true, reason: null };
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  if (total < 60) return `${total.toFixed(1)} с`;
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total - minutes * 60);
  return `${minutes} хв ${String(seconds).padStart(2, '0')} с`;
}
