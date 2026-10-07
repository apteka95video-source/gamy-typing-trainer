// Аналіз спроби, накопичена статистика клавіш і переходів, одна конкретна наступна дія.

import { FINGERS, describeKey, displayChar, keyInfo, transitionKind } from './layouts.js';
import { median } from './metrics.js';

const TRANSITION_NAMES = {
  sameKey: 'повтор тієї самої клавіші',
  sameFinger: 'один палець, дві клавіші',
  alternate: 'чергування рук',
  roll: 'перекат сусідніми пальцями',
  sameHand: 'одна рука',
  unknown: '',
};

const show = (ch) => `«${displayChar(ch)}»`;

/** Розбір однієї спроби: помилки за символами, плутанини, повільні клавіші й переходи. */
export function analyzeAttempt(session) {
  const { lang } = session;
  const errorsByChar = [...session.errorsByChar]
    .map(([ch, count]) => ({ ch, count, key: describeKey(ch, lang) }))
    .sort((a, b) => b.count - a.count || (a.ch < b.ch ? -1 : 1));
  const confusions = [...session.confusions]
    .map(([pair, count]) => {
      const [expected, typed] = pair.split('→');
      return { expected, typed, count };
    })
    .sort((a, b) => b.count - a.count);

  const typical = median(session.cleanIntervals);
  const byPair = new Map();
  for (const { pair, ms } of session.pairDelays) {
    const entry = byPair.get(pair) ?? { pair, total: 0, n: 0 };
    entry.total += ms;
    entry.n += 1;
    byPair.set(pair, entry);
  }
  const slowTransitions = [...byPair.values()]
    .map((entry) => {
      const [a, b] = [...entry.pair];
      const ms = entry.total / entry.n;
      return { pair: entry.pair, ms, n: entry.n, ratio: typical > 0 ? ms / typical : 1, kind: TRANSITION_NAMES[transitionKind(a, b, lang)] };
    })
    .filter((entry) => !entry.pair.includes(' '))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  return { errorsByChar, confusions, slowTransitions, typicalMs: typical };
}

// ---------- Накопичена статистика ----------

export function emptyStats() {
  return { keys: {}, pairs: {} };
}

/** Додає спробу до накопиченої статистики мови. Старі дані поступово згасають. */
export function updateStats(stats, session) {
  const DECAY = 0.97;
  for (const entry of Object.values(stats.keys)) {
    entry.n *= DECAY;
    entry.err *= DECAY;
    entry.ms *= DECAY;
    entry.timed *= DECAY;
  }
  for (const entry of Object.values(stats.pairs)) {
    entry.n *= DECAY;
    entry.ms *= DECAY;
  }
  const key = (ch) => {
    if (!stats.keys[ch]) stats.keys[ch] = { n: 0, err: 0, ms: 0, timed: 0 };
    return stats.keys[ch];
  };
  session.chars.forEach((ch, i) => {
    if (session.states[i] !== 'pending') key(ch).n += 1;
  });
  for (const [ch, count] of session.errorsByChar) key(ch).err += count;
  for (const { ch, ms } of session.keyDelays) {
    if (ms > 3000) continue; // пауза, а не рух пальця
    key(ch).ms += ms;
    key(ch).timed += 1;
  }
  for (const { pair, ms } of session.pairDelays) {
    if (ms > 3000) continue;
    if (!stats.pairs[pair]) stats.pairs[pair] = { n: 0, ms: 0 };
    stats.pairs[pair].n += 1;
    stats.pairs[pair].ms += ms;
  }
  return stats;
}

/**
 * Слабкі клавіші й повільні переходи за накопиченою статистикою.
 * Оцінка клавіші: частка помилок (згладжена) плюс відносна повільність.
 */
export function weakSpots(stats, lang, { limit = 6 } = {}) {
  const keyEntries = Object.entries(stats.keys).filter(([ch, e]) => e.n >= 4 && ch !== ' ' && keyInfo(ch, lang));
  const timed = keyEntries.filter(([, e]) => e.timed >= 2).map(([, e]) => e.ms / e.timed);
  const typical = median(timed) || 0;
  const keys = keyEntries
    .map(([ch, e]) => {
      const errorRate = e.err / (e.n + 4); // згладжування, щоб одна випадкова помилка не домінувала
      const avgMs = e.timed >= 2 ? e.ms / e.timed : null;
      const slowness = avgMs && typical ? Math.max(0, avgMs / typical - 1) : 0;
      return { ch, errorRate: e.err / Math.max(e.n, 1), avgMs, score: errorRate * 4 + slowness, finger: keyInfo(ch, lang).finger };
    })
    .filter((entry) => entry.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const pairEntries = Object.entries(stats.pairs).filter(([pair, e]) => e.n >= 3 && !pair.includes(' '));
  const pairTypical = median(pairEntries.map(([, e]) => e.ms / e.n)) || 0;
  const transitions = pairEntries
    .map(([pair, e]) => {
      const [a, b] = [...pair];
      const avgMs = e.ms / e.n;
      return { pair, avgMs, ratio: pairTypical ? avgMs / pairTypical : 1, kind: TRANSITION_NAMES[transitionKind(a, b, lang)] };
    })
    .filter((entry) => entry.ratio >= 1.35)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);

  return { keys, transitions, typicalKeyMs: typical, typicalPairMs: pairTypical };
}

// ---------- Одна конкретна наступна дія ----------

/**
 * Формулює рівно одну наступну дію за фактичними даними спроби (ТЗ, розділ 4.4).
 * @returns {{text: string, action: {type: string, chars?: string[], pairs?: string[]}}}
 */
export function recommend({ session, metrics, verdict, analysis, thresholds, streak, streakToPass, hasNext }) {
  const { lang } = session;
  const spm = Math.round(metrics.spm);

  if (verdict.reason === 'implausible') {
    return {
      text: 'Спробу не зараховано: текст з\'явився швидше, ніж можна набрати руками. Набери вправу вручну, клавіша за клавішею.',
      action: { type: 'retry' },
    };
  }

  if (verdict.reason === 'accuracy') {
    const top = analysis.errorsByChar[0];
    if (top && top.count >= 2 && top.count / metrics.errors >= 0.4 && top.ch !== ' ') {
      const confusion = analysis.confusions.find((c) => c.expected === top.ch);
      const instead = confusion && confusion.typed.trim() ? ` (найчастіше замість неї натискалося ${show(confusion.typed)})` : '';
      return {
        text: `Найбільше помилок на клавіші ${show(top.ch)}: ${top.count} із ${metrics.errors}${instead}. Це ${top.key}. Зроби коротку вправу саме на цю клавішу, а потім повернися до заліку.`,
        action: { type: 'drill', chars: [top.ch], pairs: [] },
      };
    }
    if (top && top.ch === ' ' && top.count / metrics.errors >= 0.4) {
      return {
        text: `Найбільше помилок на пробілі: ${top.count} із ${metrics.errors}. Пробіл натискає великий палець, решта пальців лишаються на домашньому ряді. Повтори вправу повільніше.`,
        action: { type: 'retry' },
      };
    }
    const slower = Math.max(40, Math.round((spm * 0.8) / 10) * 10);
    return {
      text: `Помилки розкидані по різних клавішах — це ознака поспіху. Знизь темп приблизно до ${slower} зн/хв (зараз ${spm}), доки точність не стане ${thresholds.minAccuracy} % або вищою.`,
      action: { type: 'retry' },
    };
  }

  if (verdict.reason === 'tempo') {
    const slow = analysis.slowTransitions[0];
    if (slow && slow.ratio >= 1.6) {
      const [a, b] = [...slow.pair];
      return {
        text: `Точність є, бракує темпу: ${spm} зн/хв за цільових ${thresholds.targetSpm}. Найбільше часу забирає перехід ${show(a)} → ${show(b)} (${Math.round(slow.ms)} мс, ${slow.kind}). Потренуй саме його.`,
        action: { type: 'drill', chars: [], pairs: [slow.pair] },
      };
    }
    return {
      text: `Точність є, бракує темпу: ${spm} зн/хв за цільових ${thresholds.targetSpm}. Повтори серію, не зупиняючись між словами; точність тримай не нижче ${thresholds.minAccuracy} %.`,
      action: { type: 'retry' },
    };
  }

  // Спробу зараховано.
  if (streak < streakToPass) {
    const slow = analysis.slowTransitions[0];
    const detail = slow && slow.ratio >= 1.8
      ? ` Зверни увагу на перехід ${show([...slow.pair][0])} → ${show([...slow.pair][1])}: він удвічі повільніший за решту.`
      : metrics.unevenness > 45
        ? ' Ритм нерівний — набирай трохи повільніше, але без пауз.'
        : '';
    return {
      text: `Зараховано ${streak} із ${streakToPass} спроб поспіль. Повтори вправу так само рівно.${detail}`,
      action: { type: 'retry' },
    };
  }

  const fixed = analysis.errorsByChar[0];
  if (fixed && fixed.count >= 2 && fixed.ch !== ' ') {
    return {
      text: `Вправу завершено. Перед наступною закріпи клавішу ${show(fixed.ch)} (${fixed.key}): на ній було ${fixed.count} виправлені помилки.`,
      action: { type: 'drill', chars: [fixed.ch], pairs: [] },
    };
  }
  return {
    text: hasNext ? 'Вправу завершено. Переходь до наступної.' : 'Вправу завершено. Продовжуй за планом заняття або повтори слабкі місця.',
    action: { type: hasNext ? 'next' : 'weak' },
  };
}

export function fingerLabel(ch, lang) {
  const info = keyInfo(ch, lang);
  return info ? FINGERS[info.finger].name : '';
}
