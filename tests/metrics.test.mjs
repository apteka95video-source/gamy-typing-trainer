// ТЗ §8.1, §8.2: формули SPM і точності на фіксованих прикладах; швидкість не зараховує вправу без точності.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAccuracy, computeMetrics, computeSpm, computeWpm, judgeAttempt, plausibility, rhythmUnevenness } from '../src/core/metrics.js';

test('SPM = 60 · N / T на фіксованих прикладах', () => {
  assert.equal(computeSpm(100, 60_000), 100);
  assert.equal(computeSpm(50, 20_000), 150);
  assert.equal(computeSpm(39, 13_000), 180);
  assert.equal(Math.round(computeSpm(120, 37_500)), 192);
  assert.equal(computeSpm(10, 0), 0, 'нульовий час не дає нескінченної швидкості');
});

test('WPM = SPM / 5', () => {
  assert.equal(computeWpm(150), 30);
});

test('точність = (N − E) / N на фіксованих прикладах', () => {
  assert.equal(computeAccuracy(100, 0), 100);
  assert.equal(computeAccuracy(100, 3), 97);
  assert.equal(computeAccuracy(60, 3), 95);
  assert.equal(computeAccuracy(40, 4), 90);
  assert.equal(computeAccuracy(10, 25), 0, 'точність не буває меншою за нуль');
});

test('нерівномірність ритму: рівні інтервали дають 0', () => {
  assert.equal(rhythmUnevenness([200, 200, 200, 200]), 0);
  assert.ok(rhythmUnevenness([100, 300, 100, 300]) > 40);
});

test('швидкість не зараховує вправу без точності', () => {
  const fastButSloppy = computeMetrics({ chars: 100, errors: 10, elapsedMs: 10_000, allIntervals: Array(99).fill(100) });
  assert.equal(Math.round(fastButSloppy.spm), 600);
  assert.deepEqual(judgeAttempt(fastButSloppy, { minAccuracy: 95, targetSpm: 150 }), { passed: false, reason: 'accuracy' });
  assert.deepEqual(judgeAttempt(fastButSloppy, { minAccuracy: 95 }), { passed: false, reason: 'accuracy' });
});

test('точна, але повільна спроба: зараховано без вимоги до темпу, не зараховано в темповій серії', () => {
  const slow = computeMetrics({ chars: 60, errors: 1, elapsedMs: 60_000, allIntervals: Array(59).fill(1000) });
  assert.equal(judgeAttempt(slow, { minAccuracy: 96 }).passed, true);
  assert.deepEqual(judgeAttempt(slow, { minAccuracy: 96, targetSpm: 150 }), { passed: false, reason: 'tempo' });
});

test('миттєвий набір (вставка, синтетична серія) не зараховується', () => {
  assert.equal(plausibility(60, 300, Array(59).fill(5)).ok, false);
  assert.equal(plausibility(60, 1500, Array(59).fill(25)).ok, false, '2400 зн/хв — понад людські можливості');
  assert.equal(plausibility(60, 12_000, Array(59).fill(200)).ok, true);
  const instant = computeMetrics({ chars: 60, errors: 0, elapsedMs: 120, allIntervals: Array(59).fill(2) });
  assert.deepEqual(judgeAttempt(instant, { minAccuracy: 95 }), { passed: false, reason: 'implausible' });
});
