#!/usr/bin/env node
// Збирання навчальної програми: data/derived/ + data/texts/ → data/curriculum/{en,uk}.json.
//
//   node scripts/build-curriculum.mjs            — записати data/curriculum/
//   node scripts/build-curriculum.mjs --out DIR  — записати в інший каталог
//
// Кожна вправа має один зрозумілий фокус (ТЗ, розділ 3). Скрипт детермінований:
// варіанти вправ добираються генератором із фіксованим зерном (ідентифікатор вправи).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FINGERS,
  HOME_KEY_OF_FINGER,
  HOME_ROW,
  KEYS,
  KEY_ROWS,
  LAYOUTS,
  homeCharOf,
  keyInfo,
  shiftFingerFor,
  transitionKind,
} from '../src/core/layouts.js';
import { createRng, shuffle } from '../src/core/rng.js';
import { ALPHABETS, isLetter, ngramsOf } from '../src/core/text.js';

export const CURRICULUM_VERSION = '1.0.0';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Порядок відкриття клавіш. Домашній ряд — першим; далі пари клавіш дзеркальних пальців.
export const COURSE_SPEC = {
  en: [
    { keys: ['f', 'j'] },
    { keys: ['d', 'k'] },
    { keys: ['s', 'l'] },
    { keys: ['a', ';'] },
    { review: 'home' },
    { keys: ['g', 'h'] },
    { keys: ['e', 'i'] },
    { keys: ['r', 'u'] },
    { keys: ['t', 'y'] },
    { keys: ['o', 'w'] },
    { keys: ['p', 'q'] },
    { keys: ['n', 'b'] },
    { keys: ['m', 'v'] },
    { keys: ['c', ','] },
    { keys: ['x', '.'] },
    { keys: ['z', "'"] },
    { review: 'vertical' },
    { review: 'fingers' },
    { shift: true, extra: [] },
    { punct: ['-', '?', '!', ':', '"'] },
    { digits: true },
  ],
  uk: [
    { keys: ['а', 'о'] },
    { keys: ['в', 'л'] },
    { keys: ['і', 'д'] },
    { keys: ['ф', 'ж'] },
    { review: 'home' },
    { keys: ['п', 'р'] },
    { keys: ['е', 'н'] },
    { keys: ['и', 'т'] },
    { keys: ['к', 'г'] },
    { keys: ['м', 'ь'] },
    { keys: ['у', 'ш'] },
    { keys: ['с', 'б'] },
    { keys: ['ц', 'щ'] },
    { keys: ['ч', 'ю'] },
    { keys: ['й', 'з'] },
    { keys: ['я', '.'] },
    { keys: ['х', 'ї'] },
    { keys: ['є', "'", 'ґ'] },
    { review: 'vertical' },
    { review: 'fingers' },
    { shift: true, extra: [','] },
    { punct: ['-', '?', '!', ':', ';', '"'] },
    { digits: true },
  ],
};

// Типові морфеми: перелік задано тут, а вага й приклади обчислюються зі словника.
const MORPHEMES = {
  en: {
    endings: ['ing', 'ed', 'er', 'ly', 'tion', 'ment', 'ness', 'able', 'est', 'ful', 'less', 'ous'],
    prefixes: ['re', 'un', 'dis', 'pre', 'over', 'out'],
  },
  uk: {
    endings: ['ння', 'ати', 'ити', 'ого', 'ому', 'ість', 'ими', 'ають', 'ться', 'ував', 'ами', 'ють'],
    prefixes: ['про', 'при', 'пере', 'роз', 'під', 'без', 'від'],
  },
};

const COUNT_WORDS = {
  en: ['days', 'minutes', 'years', 'times', 'people', 'words', 'steps', 'hours', 'months', 'pages'],
  uk: ['днів', 'хвилин', 'років', 'разів', 'людей', 'слів', 'кроків', 'годин', 'місяців', 'сторінок'],
};

const q = (ch) => `«${ch === ' ' ? 'пробіл' : ch}»`;
const fingerName = (ch, lang) => FINGERS[keyInfo(ch, lang).finger].name;

/** Повторює групи по колу, доки текст не досягне потрібної довжини. */
function cycle(groups, minChars = 46) {
  const out = [];
  let length = 0;
  for (let i = 0; length < minChars && i < 200; i += 1) {
    const group = groups[i % groups.length];
    out.push(group);
    length += group.length + 1;
  }
  return out.join(' ');
}

function loadJson(rel) {
  const buf = readFileSync(join(ROOT, rel));
  return { data: JSON.parse(buf.toString('utf8')), sha256: sha256(buf) };
}

class Builder {
  constructor(lang) {
    this.lang = lang;
    this.layout = LAYOUTS[lang];
    const words = loadJson(`data/derived/${lang}/words.json`);
    const ngrams = loadJson(`data/derived/${lang}/ngrams.json`);
    const texts = loadJson(`data/texts/${lang}.json`);
    this.inputs = {
      [`data/derived/${lang}/words.json`]: words.sha256,
      [`data/derived/${lang}/ngrams.json`]: ngrams.sha256,
      [`data/texts/${lang}.json`]: texts.sha256,
    };
    this.words = words.data.words; // [слово, частота], за спаданням частоти
    this.supplement = words.data.supplement;
    this.ngrams = ngrams.data;
    this.texts = texts.data;
    this.totalWeight = ngrams.data.totalWeight;
    this.bigramWeights = this.#weights(2);
    this.opened = new Set([' ']);
    this.lessons = [];
  }

  #weights(n) {
    const map = new Map();
    for (const [word, freq] of this.words) {
      for (const gram of new Set(ngramsOf(word, n, this.lang))) {
        map.set(gram, (map.get(gram) ?? 0) + freq);
      }
    }
    return map;
  }

  allOpened(str) {
    for (const ch of str) if (!this.opened.has(ch)) return false;
    return true;
  }

  openedString() {
    return [...this.opened].join('');
  }

  /** Слова лише з відкритих символів, за спаданням частоти. */
  openWords(filter = () => true, limit = 40, minLength = 2) {
    const out = [];
    for (const [word] of this.words) {
      if (word.length < minLength || !this.allOpened(word) || !filter(word)) continue;
      out.push(word);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Кілька детермінованих варіантів тексту з пулу слів. */
  variants(id, pool, { count = 4, minChars = 62, transform = (w) => w, lead = '' } = {}) {
    const texts = [];
    for (let v = 0; v < count; v += 1) {
      const order = shuffle(pool, createRng(`${id}#${v}`));
      const picked = [];
      let length = lead.length;
      for (const word of order) {
        if (length >= minChars) break;
        picked.push(transform(word));
        length += word.length + 1;
      }
      const text = (lead ? `${lead} ` : '') + picked.join(' ');
      if (!texts.includes(text)) texts.push(text);
    }
    return texts;
  }

  describeTransition(a, b) {
    const kinds = {
      sameKey: 'повтор тієї самої клавіші',
      sameFinger: 'один палець, дві клавіші',
      alternate: 'чергування рук',
      roll: 'перекат сусідніми пальцями',
      sameHand: 'одна рука, несусідні пальці',
    };
    const kind = transitionKind(a, b, this.lang);
    return `${q(a)} ${fingerName(a, this.lang)} → ${q(b)} ${fingerName(b, this.lang)} (${kinds[kind]})`;
  }

  /** Частка для тексту: з десятковою комою. */
  percent(weight) {
    return String(this.share(weight)).replace('.', ',');
  }

  share(weight) {
    const percent = (weight / this.totalWeight) * 100;
    return Number(percent.toFixed(percent >= 1 ? 1 : 2));
  }

  // ---------- Етап 1: клавіатурні гами ----------

  keyDrill(ch) {
    const { lang } = this;
    const home = homeCharOf(ch, lang);
    const info = keyInfo(ch, lang);
    if (home === ch) {
      return {
        kind: 'key',
        title: `Нова клавіша ${q(ch)}`,
        goal: `${fingerName(ch, lang)} лежить на ${q(ch)} постійно: це його домашня клавіша. Натискай і не відривай решту пальців від ряду. Пробіл — великим пальцем.`,
        focus: ch,
        texts: [cycle([ch.repeat(3), ch.repeat(2), ch, ch.repeat(3), ch.repeat(2), ch], 40)],
      };
    }
    const rows = ['цифровий', 'верхній', 'домашній', 'нижній'];
    const combo = info.altGr ? ' Клавіша набирається разом із правим Alt (AltGr).' : '';
    return {
      kind: 'key',
      title: `Нова клавіша ${q(ch)}`,
      goal: `${fingerName(ch, lang)}: з домашньої ${q(home)} на ${q(ch)} (${rows[info.row]} ряд) і одразу назад на ${q(home)}.${combo}`,
      focus: ch,
      texts: [cycle([home + ch + home, home + ch + home, home + home + ch, ch + ch + home, home + ch, ch + home, home + ch + ch + home], 46)],
    };
  }

  pairDrill(keys) {
    const { lang } = this;
    const [a, b] = keys;
    const ha = homeCharOf(a, lang);
    const hb = homeCharOf(b, lang);
    const groups = ha === a && hb === b
      ? [a + b, a + b, b + a, b + a, a + a + b, b + b + a, a + b + a, b + a + b]
      : [ha + a + ha, hb + b + hb, a + b, b + a, ha + a + hb + b, hb + b + ha + a, a + b + a, b + a + b];
    return {
      kind: 'pair',
      title: `${q(a)} і ${q(b)} разом`,
      goal: `Чергування двох нових клавіш: ${this.describeTransition(a, b)}. Після кожного натискання палець повертається на домашній ряд.`,
      focus: a + b,
      texts: [cycle(groups, 48)],
    };
  }

  /** Нові клавіші серед уже вивчених: найчастотніші біграми мови з новою клавішею. */
  comboDrill(keys) {
    const { lang } = this;
    const letters = keys.filter((ch) => isLetter(ch, lang));
    const grams = [...this.bigramWeights]
      .filter(([gram]) => this.allOpened(gram) && gram[0] !== gram[1] && letters.some((ch) => gram.includes(ch)))
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
      .slice(0, 8)
      .map(([gram]) => gram);
    if (grams.length >= 4) {
      return {
        kind: 'combo',
        title: `Пари клавіш із ${keys.map(q).join(' і ')}`,
        goal: `Найчастіші в мові пари літер із новими клавішами: ${grams.join(', ')}. Це ще не слова, а переходи між клавішами.`,
        focus: keys.join(''),
        texts: [cycle(grams.flatMap((gram) => [gram, gram]), 50)],
      };
    }
    // Запасний варіант (домашній ряд, розділові знаки): нова клавіша поруч із кожною домашньою.
    const homes = [...HOME_ROW[lang].left, ...HOME_ROW[lang].right].filter((ch) => this.opened.has(ch) && !keys.includes(ch));
    const groups = [];
    for (const key of keys) for (const home of homes) groups.push(isLetter(key, lang) ? home + key : home + key);
    if (groups.length < 2) return null;
    return {
      kind: 'combo',
      title: `${keys.map(q).join(' і ')} серед вивчених клавіш`,
      goal: 'Нова клавіша по черзі з кожною вже відомою клавішею домашнього ряду.',
      focus: keys.join(''),
      texts: [cycle(shuffle(groups, createRng(`${lang}-combo-${keys.join('')}`)), 48)],
    };
  }

  homeReview() {
    const { left, right } = HOME_ROW[this.lang];
    const rev = (s) => [...s].reverse().join('');
    const mirror = [...left].map((ch, i) => ch + right[right.length - 1 - i]);
    const alternate = [...left].map((ch, i) => ch + right[i]);
    return [
      {
        kind: 'scale',
        title: 'Гама зліва направо і назад',
        goal: `Послідовний рух пальців: ${left} ${right}, потім у зворотному напрямку ${rev(right)} ${rev(left)}. Усі вісім пальців лежать на домашньому ряді.`,
        focus: left + right,
        texts: [cycle([left, right, left, right, rev(right), rev(left), rev(right), rev(left)], 52)],
      },
      {
        kind: 'scale',
        title: 'Дзеркальні пари: від країв до центру й назад',
        goal: 'Однойменні пальці обох рук працюють парами: мізинці, безіменні, середні, вказівні — і у зворотному порядку.',
        focus: left + right,
        texts: [cycle([...mirror, ...mirror.slice().reverse()], 50)],
      },
      {
        kind: 'scale',
        title: 'Чергування лівої та правої руки',
        goal: 'Кожна пара — одна клавіша лівою рукою, одна правою. Руки натискають по черзі, кисті нерухомі.',
        focus: left + right,
        texts: [cycle([...alternate, ...alternate.map(rev)], 50)],
      },
      {
        kind: 'scale',
        title: 'Ізоляція однойменних пальців',
        goal: 'Рухається лише один палець, решта лежать на своїх клавішах: спершу вказівні, наприкінці мізинці.',
        focus: left + right,
        texts: [cycle([...left].reverse().flatMap((ch, i) => [ch + ch, right[i] + right[i]]).concat(mirror.slice().reverse()), 50)],
      },
      ...[
        ['повільно', 'близько 80–110 знаків за хвилину', [80, 110]],
        ['середньо', 'близько 110–140 знаків за хвилину', [110, 140]],
        ['швидше', 'близько 140–180 знаків за хвилину', [140, 180]],
      ].map(([label, band, tempoBand], i) => ({
        kind: 'rhythm',
        title: `Рівний ритм: ${label}`,
        goal: `Набирай рівно, як під метроном, ${band}. Залік — за точністю; після спроби побачиш свій темп і нерівномірність ритму.`,
        focus: left + right,
        tempoBand,
        texts: [cycle(i === 1 ? [...mirror.slice().reverse(), ...mirror] : [left, right], 50 + i * 6)],
      })),
    ];
  }

  /** Символи домашнього, верхнього та нижнього рядів для кожної «колонки» пальця. */
  columns() {
    const base = (code) => this.layout.base[code];
    return KEY_ROWS[2].slice(0, 10).map((homeCode, col) => {
      const finger = KEYS[homeCode].finger;
      return {
        finger,
        anchor: base(HOME_KEY_OF_FINGER[finger]),
        home: base(homeCode),
        top: base(KEY_ROWS[1][col]),
        bottom: base(KEY_ROWS[3][col]),
      };
    });
  }

  verticalReview() {
    const cols = this.columns().filter((c) => c.home === c.anchor);
    const ok = (...chars) => chars.every((ch) => this.opened.has(ch));
    const up = cols.filter((c) => ok(c.top)).map((c) => c.home + c.top + c.home);
    const down = cols.filter((c) => ok(c.bottom)).map((c) => c.home + c.bottom + c.home);
    const both = cols.filter((c) => ok(c.top, c.bottom)).map((c) => c.home + c.top + c.home + c.bottom + c.home);
    return [
      {
        kind: 'scale',
        title: 'Вертикаль: домашній → верхній ряд',
        goal: 'Кожен палець тягнеться вгору до своєї клавіші та повертається на домашню. Кисть не рухається.',
        focus: up.join(''),
        texts: [cycle(up, 50)],
      },
      {
        kind: 'scale',
        title: 'Вертикаль: домашній → нижній ряд',
        goal: 'Кожен палець опускається до своєї клавіші нижнього ряду та повертається на домашню.',
        focus: down.join(''),
        texts: [cycle(down, 50)],
      },
      {
        kind: 'scale',
        title: 'Вертикаль: домашній → верхній → нижній',
        goal: 'Повний вертикальний перехід одним пальцем через три ряди з поверненням на домашню клавішу.',
        focus: both.join(''),
        texts: [cycle(both, 52)],
      },
    ];
  }

  fingersReview() {
    const { lang } = this;
    const cols = this.columns();
    const byFinger = (finger) => {
      const anchor = this.layout.base[HOME_KEY_OF_FINGER[finger]];
      const chars = cols.filter((c) => c.finger === finger).flatMap((c) => [c.top, c.home, c.bottom]);
      return chars.filter((ch) => ch !== anchor && this.opened.has(ch) && isLetter(ch, lang)).map((ch) => anchor + ch + anchor);
    };
    const row = (index) => KEY_ROWS[index].map((code) => this.layout.base[code]).filter((ch) => this.opened.has(ch) && isLetter(ch, lang)).join('');
    const rows = [row(1), row(2), row(3)];
    const split = (s) => [s.slice(0, Math.ceil(s.length / 2)), s.slice(Math.ceil(s.length / 2))];
    const rev = (s) => [...s].reverse().join('');
    return [
      {
        kind: 'scale',
        title: 'Вказівні пальці: шість клавіш кожен',
        goal: 'Вказівний палець відповідає за шість клавіш. Щоразу він повертається на свою домашню клавішу з виступом.',
        focus: [...byFinger('L2'), ...byFinger('R2')].join(''),
        texts: [cycle([...byFinger('L2'), ...byFinger('R2')], 54)],
      },
      {
        kind: 'scale',
        title: 'Середні, безіменні та мізинці',
        goal: 'Контроль одного пальця на кількох закріплених за ним клавішах: від середніх пальців до мізинців.',
        focus: ['L3', 'R3', 'L4', 'R4', 'L5', 'R5'].flatMap(byFinger).join(''),
        texts: [cycle(['L3', 'R3', 'L4', 'R4', 'L5', 'R5'].flatMap(byFinger), 54)],
      },
      {
        kind: 'scale',
        title: 'Ряди цілком: зліва направо і назад',
        goal: 'Послідовний рух по кожному ряду: верхній, домашній, нижній — туди й назад.',
        focus: rows.join(''),
        texts: [cycle(rows.flatMap(split).concat(rows.map(rev).flatMap(split)), 60)],
      },
    ];
  }

  shiftDrills(extra) {
    const { lang } = this;
    const letters = [...this.opened].filter((ch) => isLetter(ch, lang) && !keyInfo(ch, lang).altGr && ch !== 'ь');
    const upper = (ch) => ch.toUpperCase();
    const right = letters.filter((ch) => keyInfo(ch, lang).hand === 'R').slice(0, 10);
    const left = letters.filter((ch) => keyInfo(ch, lang).hand === 'L').slice(0, 10);
    const drills = [
      {
        kind: 'shift',
        title: 'Лівий Shift і права рука',
        goal: 'Велику літеру правої руки набирай, утримуючи лівий Shift лівим мізинцем. Після натискання мізинець повертається на домашню клавішу.',
        focus: right.map(upper).join(''),
        texts: [cycle(right.map((ch) => upper(ch) + ch), 48)],
      },
      {
        kind: 'shift',
        title: 'Правий Shift і ліва рука',
        goal: 'Велику літеру лівої руки набирай, утримуючи правий Shift правим мізинцем.',
        focus: left.map(upper).join(''),
        texts: [cycle(left.map((ch) => upper(ch) + ch), 48)],
      },
      {
        kind: 'shift',
        title: 'Shift по черзі обома мізинцями',
        goal: 'Shift завжди натискає мізинець руки, протилежної літері. Тут руки міняються щопари.',
        focus: [...left, ...right].map(upper).join(''),
        texts: [cycle(left.slice(0, 6).flatMap((ch, i) => [upper(ch) + right[i], upper(right[i]) + ch]), 50)],
      },
    ];
    for (const ch of extra) {
      const home = homeCharOf(ch, lang);
      drills.push({
        kind: 'key',
        title: `Нова клавіша ${q(ch)}`,
        goal: `${fingerName(ch, lang)} із Shift (${FINGERS[shiftFingerFor(ch, lang)].name}): ${q(home)} → ${q(ch)} → ${q(home)}.`,
        focus: ch,
        texts: [cycle([home + ch, home + ch, `${home}${ch}${home}`, `${home}${home}${ch}`], 44)],
      });
    }
    return drills;
  }

  punctDrills(signs) {
    const { lang } = this;
    const drills = [];
    for (let i = 0; i < signs.length; i += 2) {
      const pair = signs.slice(i, i + 2);
      const groups = pair.flatMap((ch) => {
        const home = homeCharOf(ch, lang);
        return [home + ch + home, home + ch, ch + home];
      });
      drills.push({
        kind: 'punct',
        title: `Розділові знаки ${pair.map(q).join(' і ')}`,
        goal: pair.map((ch) => {
          const shift = shiftFingerFor(ch, lang);
          return `${q(ch)} — ${fingerName(ch, lang)}${shift ? ` із Shift (${FINGERS[shift].name})` : ''}`;
        }).join('; ') + '. Кожен знак — окремий рух із поверненням на домашній ряд.',
        focus: pair.join(''),
        texts: [cycle(groups, 46)],
      });
    }
    return drills;
  }

  digitDrills() {
    const { lang } = this;
    const group = (digits) => [...digits].map((d) => {
      const home = homeCharOf(d, lang);
      return home + d + home;
    });
    return [
      {
        kind: 'digits',
        title: 'Цифри лівої руки: 1–5',
        goal: 'Палець тягнеться через верхній ряд до цифри та повертається на домашню клавішу: 1 — мізинець, 2 — безіменний, 3 — середній, 4 і 5 — вказівний.',
        focus: '12345',
        texts: [cycle(group('12345'), 46)],
      },
      {
        kind: 'digits',
        title: 'Цифри правої руки: 6–0',
        goal: '6 і 7 — правий вказівний, 8 — середній, 9 — безіменний, 0 — мізинець. Після цифри палець повертається додому.',
        focus: '67890',
        texts: [cycle(group('67890'), 46)],
      },
      {
        kind: 'digits',
        title: 'Усі цифри',
        goal: 'Цифровий ряд цілком: зліва направо, назад, непарні й парні.',
        focus: '1234567890',
        texts: ['12345 67890 09876 54321 13579 24680 10 29 38 47 56'],
      },
    ];
  }

  // ---------- Етап 2: слова з відкритих клавіш ----------

  wordExercises(lessonId, newKeys) {
    const { lang } = this;
    const out = [];
    const letters = newKeys.filter((ch) => isLetter(ch, lang));
    const fingers = letters.map((ch) => `${q(ch)} — ${fingerName(ch, lang)}`).join(', ');
    const base = 'Справжні слова лише з уже відкритих клавіш.';

    if (letters.length) {
      const pool = this.openWords((w) => letters.some((ch) => w.includes(ch)), 36);
      if (pool.length >= 8) {
        out.push({
          kind: 'words-new',
          title: `Слова з ${letters.map(q).join(' і ')}`,
          goal: `${base} У кожному слові є нова клавіша: ${fingers}.`,
          focus: letters.join(''),
          texts: this.variants(`${lessonId}-new`, pool),
        });
      }
    }
    const frequent = this.openWords(() => true, 60);
    if (frequent.length >= 10) {
      out.push({
        kind: 'words-frequent',
        title: 'Найчастіші слова з відкритих клавіш',
        goal: `${base} Це найуживаніші слова мови, які вже можна набрати.`,
        focus: '',
        texts: this.variants(`${lessonId}-freq`, frequent),
      });
    }
    const long = this.openWords(() => true, 40, 6);
    if (long.length >= 12) {
      out.push({
        kind: 'words-long',
        title: 'Довші слова',
        goal: `${base} Слова від шести літер: тримай рівний ритм до кінця слова.`,
        focus: '',
        texts: this.variants(`${lessonId}-long`, long, { minChars: 66 }),
      });
    }
    const signs = newKeys.filter((ch) => ch === '.' || ch === ',');
    if (signs.length && frequent.length >= 10) {
      const comma = this.opened.has(',');
      const dot = this.opened.has('.');
      const transformFor = (v) => (word, i) => {
        if (comma && dot) return word + ((i + v) % 2 ? '.' : ',');
        return word + (dot ? '.' : ',');
      };
      const texts = [];
      for (let v = 0; v < 4; v += 1) {
        const order = shuffle(frequent, createRng(`${lessonId}-sign#${v}`)).slice(0, 10);
        texts.push(order.map(transformFor(v)).join(' '));
      }
      out.push({
        kind: 'words-punct',
        title: `Слова з ${signs.map(q).join(' і ')}`,
        goal: `${base} Після слова — знак, далі пробіл великим пальцем: ${signs.map((ch) => `${q(ch)} — ${fingerName(ch, lang)}`).join(', ')}.`,
        focus: signs.join(''),
        texts,
      });
    }
    return out;
  }

  homeWords(lessonId) {
    const pool = this.openWords(() => true, 40);
    if (pool.length < 8) return [];
    return [{
      kind: 'words-frequent',
      title: 'Слова домашнього ряду',
      goal: 'Перші справжні слова: у них лише клавіші домашнього ряду. Пальці не залишають свого ряду.',
      focus: '',
      texts: this.variants(`${lessonId}-home`, pool, { minChars: 54 }),
    }];
  }

  mechanicsWords(lessonId, which) {
    const { lang } = this;
    const out = [];
    const base = 'Справжні слова лише з уже відкритих клавіш.';
    const kindsOf = (word) => {
      const kinds = [];
      for (let i = 1; i < word.length; i += 1) kinds.push(transitionKind(word[i - 1], word[i], lang));
      return kinds;
    };
    if (which === 'vertical') {
      const sameFinger = this.openWords((w) => kindsOf(w).includes('sameFinger'), 36, 3);
      out.push({
        kind: 'words-same-finger',
        title: 'Один палець між рядами',
        goal: `${base} У кожному слові один палець натискає дві різні клавіші поспіль — не поспішай на цьому переході.`,
        focus: '',
        texts: this.variants(`${lessonId}-sf`, sameFinger),
      });
      const repeats = this.openWords((w) => kindsOf(w).includes('sameKey'), 36, 3);
      out.push({
        kind: 'words-repeat',
        title: 'Повтори тієї самої клавіші',
        goal: `${base} У кожному слові є подвоєна літера: два рівні натискання одним пальцем.`,
        focus: '',
        texts: this.variants(`${lessonId}-rep`, repeats),
      });
    } else {
      const alternating = this.openWords((w) => kindsOf(w).every((k) => k === 'alternate'), 36, 4);
      out.push({
        kind: 'words-alternate',
        title: 'Чергування рук у словах',
        goal: `${base} Кожна наступна літера — іншою рукою: такі слова набираються найрівніше.`,
        focus: '',
        texts: this.variants(`${lessonId}-alt`, alternating),
      });
      if (lang === 'uk') {
        const special = this.openWords((w) => /[ґєїі]/.test(w), 30, 3)
          .filter((w) => /[єї]/.test(w)).slice(0, 18)
          .concat(this.supplement.filter((w) => w.includes('ґ') && this.allOpened(w)).slice(0, 12))
          .concat(this.openWords((w) => w.includes('і'), 10, 4));
        out.push({
          kind: 'words-ukrainian',
          title: 'Українські літери ґ, є, ї, і',
          goal: `${base} Літери ґ, є, ї, і набираються саме своїми клавішами: програма ніколи не замінює їх на г, е, и чи латинську i.`,
          focus: 'ґєїі',
          texts: this.variants(`${lessonId}-gyi`, special),
        });
      }
      out.push({
        kind: 'words-frequent',
        title: 'Найчастіші слова: усі літери',
        goal: `${base} Усі літери абетки вже відкриті — це найуживаніші слова мови.`,
        focus: '',
        texts: this.variants(`${lessonId}-all`, this.openWords(() => true, 80, 3)),
      });
    }
    return out;
  }

  shiftWords(lessonId, extra) {
    const cap = (w) => w[0].toUpperCase() + w.slice(1);
    const pool = this.openWords(() => true, 40, 3);
    const out = [{
      kind: 'words-capital',
      title: 'Слова з великої літери',
      goal: 'Справжні слова лише з відкритих клавіш. Перша літера — велика: Shift мізинцем протилежної руки.',
      focus: '',
      texts: this.variants(`${lessonId}-cap`, pool, { transform: cap }),
    }];
    if (extra.includes(',')) {
      const texts = [];
      for (let v = 0; v < 4; v += 1) {
        const order = shuffle(pool, createRng(`${lessonId}-comma#${v}`)).slice(0, 10);
        texts.push(order.map((w, i) => (i % 5 === 0 ? cap(w) : w) + (i % 5 === 4 ? '.' : ',')).join(' '));
      }
      out.push({
        kind: 'words-punct',
        title: 'Слова з комою і крапкою',
        goal: 'Справжні слова лише з відкритих клавіш. Кома — Shift і та сама клавіша, що й крапка; після знака — пробіл.',
        focus: ',.',
        texts,
      });
    }
    return out;
  }

  punctWords(lessonId, signs) {
    const out = [];
    const base = 'Справжні слова лише з уже відкритих клавіш.';
    const apostrophe = [...this.openWords((w) => w.includes("'"), 20), ...this.supplement.filter((w) => w.includes("'") && this.allOpened(w))];
    if (apostrophe.length >= 8) {
      out.push({
        kind: 'words-apostrophe',
        title: 'Слова з апострофом',
        goal: `${base} Апостроф — окремий рух усередині слова; будь-який варіант апострофа (', ’, ʼ) зараховується як той самий знак.`,
        focus: "'",
        texts: this.variants(`${lessonId}-apo`, [...new Set(apostrophe)]),
      });
    }
    const hyphen = this.openWords((w) => w.includes('-'), 30);
    if (hyphen.length >= 8) {
      out.push({
        kind: 'words-hyphen',
        title: 'Слова з дефісом',
        goal: `${base} Дефіс — правим мізинцем через цифровий ряд, без пробілів навколо.`,
        focus: '-',
        texts: this.variants(`${lessonId}-hyp`, hyphen),
      });
    }
    const marks = signs.filter((ch) => '?!:;'.includes(ch));
    const pool = this.openWords(() => true, 40, 3);
    const texts = [];
    for (let v = 0; v < 4; v += 1) {
      const order = shuffle(pool, createRng(`${lessonId}-marks#${v}`)).slice(0, 10);
      texts.push(order.map((w, i) => w + marks[(i + v) % marks.length]).join(' '));
    }
    out.push({
      kind: 'words-punct',
      title: `Слова зі знаками ${marks.map(q).join(' ')}`,
      goal: `${base} Знак ставиться одразу після слова, далі — пробіл.`,
      focus: marks.join(''),
      texts,
    });
    return out;
  }

  digitWords(lessonId) {
    const known = new Set(this.words.map(([w]) => w));
    const nouns = COUNT_WORDS[this.lang].filter((w) => known.has(w) && this.allOpened(w));
    const texts = [];
    for (let v = 0; v < 4; v += 1) {
      const rng = createRng(`${lessonId}-num#${v}`);
      const order = shuffle(nouns, rng);
      // Числа, після яких іменник стоїть у родовому множини (5–20, 25–30, …): «12 днів», а не «22 днів».
      const number = () => {
        for (;;) {
          const n = Math.floor(rng() * 95) + 5;
          if ((n >= 5 && n <= 20) || n % 10 === 0 || n % 10 >= 5) return n;
        }
      };
      texts.push(order.slice(0, 8).map((w) => `${number()} ${w}`).join(' '));
    }
    return [{
      kind: 'words-numbers',
      title: 'Числа зі словами',
      goal: 'Справжні слова лише з відкритих клавіш і числа перед ними. Після числа палець повертається на домашній ряд.',
      focus: '1234567890',
      texts,
    }];
  }

  // ---------- Збирання уроків ----------

  buildLessons() {
    const { lang } = this;
    COURSE_SPEC[lang].forEach((spec, index) => {
      const n = index + 1;
      const id = `${lang}-l${String(n).padStart(2, '0')}`;
      let title;
      let kind;
      let newKeys = [];
      let stage1 = [];
      let stage2 = [];

      if (spec.keys) {
        kind = 'keys';
        newKeys = spec.keys;
        title = `Клавіші ${spec.keys.length > 2 ? `${spec.keys.slice(0, -1).map(q).join(', ')} і ${q(spec.keys.at(-1))}` : spec.keys.map(q).join(' і ')}`;
        for (const ch of spec.keys) {
          this.opened.add(ch);
          stage1.push(this.keyDrill(ch));
        }
        if (spec.keys.length === 2) stage1.push(this.pairDrill(spec.keys));
        const combo = this.comboDrill(spec.keys);
        if (combo) stage1.push(combo);
        stage2 = this.wordExercises(id, spec.keys);
      } else if (spec.review === 'home') {
        kind = 'review';
        title = 'Гами домашнього ряду';
        stage1 = this.homeReview();
        stage2 = this.homeWords(id);
      } else if (spec.review === 'vertical') {
        kind = 'review';
        title = 'Вертикальні переходи між рядами';
        stage1 = this.verticalReview();
        stage2 = this.mechanicsWords(id, 'vertical');
      } else if (spec.review === 'fingers') {
        kind = 'review';
        title = 'Один палець — кілька клавіш';
        stage1 = this.fingersReview();
        stage2 = this.mechanicsWords(id, 'fingers');
      } else if (spec.shift) {
        kind = 'shift';
        title = spec.extra.length ? `Shift, великі літери і ${spec.extra.map(q).join(' ')}` : 'Shift і великі літери';
        stage1 = this.shiftDrills(spec.extra);
        for (const ch of [...this.opened]) if (isLetter(ch, lang)) this.opened.add(ch.toUpperCase());
        for (const ch of spec.extra) this.opened.add(ch);
        newKeys = ['Shift', ...spec.extra];
        stage2 = this.shiftWords(id, spec.extra);
      } else if (spec.punct) {
        kind = 'punct';
        title = `Розділові знаки ${spec.punct.join(' ')}`;
        newKeys = spec.punct;
        for (const ch of spec.punct) this.opened.add(ch);
        stage1 = this.punctDrills(spec.punct);
        stage2 = this.punctWords(id, spec.punct);
      } else if (spec.digits) {
        kind = 'digits';
        title = 'Цифри';
        newKeys = [...'1234567890'];
        for (const ch of newKeys) this.opened.add(ch);
        stage1 = this.digitDrills();
        stage2 = this.digitWords(id);
      }

      const number = (list, stage) => list.map((exercise, i) => ({
        id: `${id}-s${stage}-${String(i + 1).padStart(2, '0')}`,
        stage,
        mechanical: stage === 1,
        ...exercise,
      }));
      this.lessons.push({
        id,
        n,
        kind,
        title,
        newKeys,
        opened: this.openedString(),
        exercises: [...number(stage1, 1), ...number(stage2, 2)],
      });
    });
  }

  // ---------- Етап 3: Академія ----------

  gramExercise(gram, weight, words, rank, label) {
    const transitions = [];
    for (let i = 1; i < gram.length; i += 1) transitions.push(this.describeTransition(gram[i - 1], gram[i]));
    return {
      kind: 'ngram',
      title: `${label} «${gram}»`,
      goal: `№ ${rank} за частотою: трапляється у словах, що дають ${this.percent(weight)} % усіх слововживань. ${transitions.join('; ')}.`,
      focus: gram,
      ngram: gram,
      share: this.share(weight),
      pool: words,
    };
  }

  morphemeEntries() {
    const { endings, prefixes } = MORPHEMES[this.lang];
    const collect = (morpheme, test) => {
      let weight = 0;
      const words = [];
      for (const [word, freq] of this.words) {
        if (word.length < morpheme.length + 2 || !test(word)) continue;
        weight += freq;
        if (words.length < 18) words.push(word);
      }
      return { morpheme, weight, words };
    };
    return {
      endings: endings.map((m) => collect(m, (w) => w.endsWith(m))).filter((e) => e.words.length >= 10).sort((a, b) => b.weight - a.weight),
      prefixes: prefixes.map((m) => collect(m, (w) => w.startsWith(m))).filter((e) => e.words.length >= 10).sort((a, b) => b.weight - a.weight),
    };
  }

  buildAcademy() {
    const { lang } = this;
    const modules = [];
    const criterion = 'Модуль завершено, коли кожну його вправу зараховано.';
    const add = (title, description, exercises) => {
      const n = modules.length + 1;
      const id = `${lang}-a${String(n).padStart(2, '0')}`;
      modules.push({
        id,
        n,
        title,
        description,
        criterion,
        exercises: exercises.map((exercise, i) => {
          const exId = `${id}-${String(i + 1).padStart(2, '0')}`;
          const { pool, lead, ...rest } = exercise;
          const texts = rest.texts ?? this.variants(exId, pool, { count: 3, minChars: 70, lead: lead ?? '' });
          return { id: exId, stage: 3, mechanical: false, ...rest, texts };
        }),
      });
    };
    const withLead = (exercise, lead) => ({ ...exercise, lead });
    const byKind = (kind, limit) => [...this.bigramWeights]
      .filter(([gram]) => transitionKind(gram[0], gram[1], lang) === kind)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, limit)
      .map(([gram, weight]) => ({ gram, weight, words: this.words.filter(([w]) => w.includes(gram)).slice(0, 18).map(([w]) => w) }));

    const bigrams = this.ngrams.bigrams.filter((e) => e.gram[0] !== e.gram[1]).slice(0, 10);
    add('Найчастіші біграми', 'Десять найчастотніших пар літер усередині слів. Вага пари — сума частот слів, у яких вона трапляється.',
      bigrams.map((e, i) => withLead(this.gramExercise(e.gram, e.weight, e.words.filter((w) => w.length > 2).slice(0, 16), i + 1, 'Біграма'), `${e.gram} ${e.gram} ${e.gram}`)));

    const trigrams = this.ngrams.trigrams.slice(0, 8);
    add('Найчастіші триграми', 'Вісім найчастотніших трійок літер. Три натискання мають злитися в один рух.',
      trigrams.map((e, i) => withLead(this.gramExercise(e.gram, e.weight, e.words.filter((w) => w.length > 3).slice(0, 16), i + 1, 'Триграма'), `${e.gram} ${e.gram} ${e.gram}`)));

    const morphemes = this.morphemeEntries();
    add('Закінчення, суфікси та префікси', 'Типові морфеми мови: вага кожної обчислена зі словника як сума частот слів із цією морфемою.', [
      ...morphemes.endings.slice(0, 7).map((e) => ({
        kind: 'morpheme',
        title: `Закінчення «-${e.morpheme}»`,
        goal: `Слова на «-${e.morpheme}» дають ${this.percent(e.weight)} % слововживань. Закінчення набирається одним злитим рухом.`,
        focus: e.morpheme,
        ngram: e.morpheme,
        share: this.share(e.weight),
        pool: e.words,
        lead: `${e.morpheme} ${e.morpheme}`,
      })),
      ...morphemes.prefixes.slice(0, 4).map((e) => ({
        kind: 'morpheme',
        title: `Префікс «${e.morpheme}-»`,
        goal: `Слова на «${e.morpheme}-» дають ${this.percent(e.weight)} % слововживань. Початок слова набирається одним злитим рухом.`,
        focus: e.morpheme,
        ngram: e.morpheme,
        share: this.share(e.weight),
        pool: e.words,
        lead: `${e.morpheme} ${e.morpheme}`,
      })),
    ]);

    add('Складні переходи одним пальцем', 'Найчастіші пари літер, які набирає той самий палець на різних клавішах. Тут важлива не швидкість, а чистий рух.',
      byKind('sameFinger', 8).map((e, i) => withLead(this.gramExercise(e.gram, e.weight, e.words, i + 1, 'Перехід'), `${e.gram} ${e.gram} ${e.gram}`)));

    const alternating = this.words.filter(([w]) => {
      if (w.length < 5 || !this.allOpened(w)) return false;
      for (let i = 1; i < w.length; i += 1) if (transitionKind(w[i - 1], w[i], lang) !== 'alternate') return false;
      return true;
    }).map(([w]) => w);
    add('Чергування рук і перекати', 'Слова, де руки працюють по черзі, та «перекати» — пари літер сусідніми пальцями однієї руки.', [
      {
        kind: 'alternate',
        title: 'Чергування рук: часті слова',
        goal: 'Кожна наступна літера — іншою рукою. Тримай рівний ритм: ліва, права, ліва, права.',
        focus: '',
        pool: alternating.slice(0, 30),
      },
      {
        kind: 'alternate',
        title: 'Чергування рук: довгі слова',
        goal: 'Довші слова з повним чергуванням рук. Не прискорюйся посеред слова.',
        focus: '',
        pool: alternating.filter((w) => w.length >= 6).slice(0, 30),
      },
      ...byKind('roll', 6).map((e, i) => withLead(this.gramExercise(e.gram, e.weight, e.words, i + 1, 'Перекат'), `${e.gram} ${e.gram} ${e.gram}`)),
    ]);

    const doubles = this.ngrams.doubles.filter((e) => e.words.filter((w) => w.length > 3).length >= 8).slice(0, 6);
    add('Подвоєння літер', 'Подвоєна літера — два рівні натискання одним пальцем без напруження.',
      doubles.map((e, i) => withLead(this.gramExercise(e.gram, e.weight, e.words.filter((w) => w.length > 3).slice(0, 16), i + 1, 'Подвоєння'), `${e.gram} ${e.gram} ${e.gram}`)));

    const chunk = (list, size) => {
      const out = [];
      for (let i = 0; i + size <= list.length; i += size) out.push(list.slice(i, i + size));
      return out;
    };
    add('Великі літери, розділові знаки й числа', 'Апостроф, дефіс, кома, крапка, лапки, знаки питання й оклику та числа у справжніх реченнях.', [
      ...chunk(this.texts.punctuation, 3).map((group, i) => ({
        kind: 'punctuation',
        title: `Розділові знаки в реченнях ${i + 1}`,
        goal: 'Великі літери — із Shift мізинцем протилежної руки; після кожного знака палець повертається на домашній ряд.',
        focus: '',
        texts: [group.join(' '), group.slice().reverse().join(' ')],
      })),
      ...chunk(this.texts.numbers, 2).map((group, i) => ({
        kind: 'numbers',
        title: `Числа в реченнях ${i + 1}`,
        goal: 'Цифри набираються тими самими пальцями, що й клавіші під ними; після числа рука повертається на домашній ряд.',
        focus: '1234567890',
        texts: [group.join(' '), group.slice().reverse().join(' ')],
      })),
    ]);

    add('Речення', 'Перенесення навички в зв\'язний текст: короткі речення з великими літерами та розділовими знаками.',
      chunk(this.texts.sentences, 3).map((group, i) => ({
        kind: 'sentences',
        title: `Речення ${i + 1}`,
        goal: 'Набирай рівно, не зупиняючись між словами. Погляд — на тексті, не на клавіатурі.',
        focus: '',
        texts: [group.join(' '), [group[1], group[2], group[0]].join(' ')],
      })));

    add('Абзаци', 'Суцільний текст: один абзац — одна вправа. Мета — рівний ритм на довгій дистанції.',
      this.texts.paragraphs.map((text, i) => ({
        kind: 'paragraph',
        title: `Абзац ${i + 1}`,
        goal: 'Суцільний текст. Якщо точність падає — зменш темп, а не кількість уваги.',
        focus: '',
        texts: [text],
      })));

    const top = (n) => this.words.filter(([w]) => w.length >= 2 && this.allOpened(w)).slice(0, n).map(([w]) => w);
    add('Темпові серії', 'Короткі серії найчастіших слів на швидкість. Єдиний модуль, де для заліку потрібен і темп, і точність: швидкість без точності не зараховується.',
      [50, 100, 150, 200, 300, 500].map((n, i) => ({
        kind: 'tempo',
        title: `Темпова серія ${i + 1}: ${n} найчастіших слів`,
        goal: 'Коротка серія на темп. Залік: точність не нижча за поріг і швидкість не нижча за цільову з налаштувань.',
        focus: '',
        tempo: true,
        texts: this.variants(`${lang}-tempo-${n}`, top(n).slice(i === 0 ? 0 : Math.floor(n / 3)), { count: 4, minChars: 56 }),
      })));

    this.academy = modules;
  }

  build() {
    this.buildLessons();
    this.buildAcademy();
    return {
      schema: 1,
      version: CURRICULUM_VERSION,
      language: this.lang,
      layout: this.layout.name,
      inputs: this.inputs,
      diagnostic: this.texts.sentences.slice(0, 3).join(' '),
      lessons: this.lessons,
      academy: this.academy,
    };
  }
}

export function buildCurriculum(outDir = join(ROOT, 'data/curriculum')) {
  mkdirSync(outDir, { recursive: true });
  const summary = {};
  for (const lang of ['en', 'uk']) {
    const curriculum = new Builder(lang).build();
    writeFileSync(join(outDir, `${lang}.json`), `${JSON.stringify(curriculum, null, 1)}\n`);
    const count = (stage) => [...curriculum.lessons.flatMap((l) => l.exercises), ...curriculum.academy.flatMap((m) => m.exercises)].filter((e) => e.stage === stage).length;
    summary[lang] = { lessons: curriculum.lessons.length, modules: curriculum.academy.length, stage1: count(1), stage2: count(2), stage3: count(3) };
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFlag = process.argv.indexOf('--out');
  const summary = buildCurriculum(outFlag === -1 ? undefined : resolve(process.argv[outFlag + 1]));
  for (const [lang, info] of Object.entries(summary)) console.log(`[${lang}]`, JSON.stringify(info));
}

export { ALPHABETS };
