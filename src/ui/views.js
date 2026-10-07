// Екрани застосунку, крім тренувального (той — у trainer.js).

import { weakSpots } from '../core/analysis.js';
import { DEFAULT_SETTINGS, LEVELS, PLAUSIBILITY, SETTING_LIMITS, clampSetting, levelForSpm } from '../core/config.js';
import { HOME_ROW, KEYS, keyInfo } from '../core/layouts.js';
import { formatDuration } from '../core/metrics.js';
import { coursePosition, exerciseRecord, groupProgress, isPassed, nextExercise, openedChars } from '../core/progress.js';
import { createProfile, exportProfile, importProfile } from '../core/storage.js';
import { fmt, h, keycaps, svg } from './dom.js';
import { fingerLegend, fingerTable, renderKeyboard } from './keyboard.js';
import { trainerView } from './trainer.js';

const LANG = {
  uk: { name: 'Українська', layout: 'ЙЦУКЕН', adjective: 'українська' },
  en: { name: 'English', layout: 'QWERTY', adjective: 'англійська' },
};

const STAGES = {
  1: {
    title: 'Етап 1 · Клавіатурні гами',
    lead: 'Короткі повторювані рухи без змісту, як гами на фортепіано: нова клавіша, її палець і повернення на домашній ряд. Мета — не дивитися на клавіатуру.',
  },
  2: {
    title: 'Етап 2 · Слова з вивчених клавіш',
    lead: 'Справжні слова мови. Слово потрапляє у вправу лише тоді, коли всі його символи вже відкриті на етапі 1.',
  },
  3: {
    title: 'Етап 3 · Академія',
    lead: 'Частотні біграми й триграми, морфеми, складні переходи, речення, абзаци й темпові серії. Швидкість зростає лише разом із точністю.',
  },
};

const progressBar = (passed, total, label) => h('div', {
  class: 'progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(passed), 'aria-label': label,
}, h('span', { style: { width: `${total ? (passed / total) * 100 : 0}%` } }));

function criterionLine(settings, stage) {
  return `Критерій завершення вправи: ${settings.streakToPass} ${settings.streakToPass === 1 ? 'успішна спроба' : 'успішні спроби поспіль'} з точністю не нижче ${settings.minAccuracy[stage]} %.`;
}

function exerciseItem(app, course, exercise) {
  const settings = app.settings;
  const record = exerciseRecord(app.progress(), exercise.id);
  const unlocked = app.unlocked(course, exercise.id);
  let state;
  if (record.passed) state = h('span', { class: 'badge ok' }, '✓ зараховано');
  else if (!unlocked) state = h('span', { class: 'badge' }, 'закрито');
  else state = h('span', { class: 'badge warn' }, `${Math.min(record.streak, settings.streakToPass)} з ${settings.streakToPass} спроб`);
  return h('li', { class: `ex-item${unlocked ? '' : ' locked'}` }, [
    unlocked ? h('a', { href: `#/ex/${exercise.id}` }, exercise.title) : h('span', {}, exercise.title),
    h('span', { class: 'ex-state' }, [
      record.bestSpm > 0 && h('span', { class: 'muted small' }, `рекорд ${fmt.int(record.bestSpm)} зн/хв`),
      state,
    ]),
  ]);
}

// ---------- Перший запуск ----------

export async function onboarding(app) {
  const lang = app.lang;
  const choose = (freeAccess, target) => {
    app.profile.onboarded[lang] = true;
    if (freeAccess) app.profile.settings.freeAccess = true;
    app.save();
    app.go(target);
  };
  const langButton = (code) => h('button', {
    type: 'button', class: lang === code ? 'primary' : '', 'aria-pressed': String(lang === code), dataset: { lang: code },
    onclick: () => app.setLang(code),
  }, [h('strong', {}, LANG[code].name), h('span', {}, `розкладка ${LANG[code].layout}`)]);

  return h('div', {}, [
    h('div', { class: 'hero' }, [
      h('h1', {}, 'Гами — тренажер сенсорного набору'),
      h('p', { class: 'lead' }, 'Набір наосліп десятьма пальцями: спершу точність і правильний палець, швидкість — потім. Три етапи, як у музичній школі: гами, слова, швидкі пасажі.'),
    ]),
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 } }, '1. Мова набору'),
      h('p', {}, 'Курси для української та англійської окремі; перемкнути мову можна будь-коли у верхньому меню.'),
      h('div', { class: 'choice', role: 'group', 'aria-label': 'Мова набору' }, [langButton('uk'), langButton('en')]),
      h('h2', {}, '2. З чого почати'),
      h('p', {}, `Обрано: ${LANG[lang].adjective} мова, розкладка ${LANG[lang].layout}.`),
      h('div', { class: 'choice' }, [
        h('button', { type: 'button', class: 'primary', id: 'start-beginner', dataset: { autofocus: 'true' }, onclick: () => choose(false, '#/') }, [
          h('strong', {}, 'Починаю з нуля'),
          h('span', {}, 'Перший урок: дві клавіші домашнього ряду. Нові клавіші відкриваються поступово.'),
        ]),
        h('button', { type: 'button', id: 'start-diagnostic', onclick: () => app.go('#/diagnostic') }, [
          h('strong', {}, 'Не знаю свого рівня'),
          h('span', {}, 'Діагностика на одну хвилину: набери три речення, і програма порадить, з чого почати.'),
        ]),
        h('button', { type: 'button', id: 'start-advanced', onclick: () => choose(true, '#/academy') }, [
          h('strong', {}, 'Уже набираю наосліп'),
          h('span', {}, 'Відкрити всі вправи одразу й перейти до Академії: біграми, тексти, темпові серії.'),
        ]),
      ]),
    ]),
    h('div', { class: 'grid three' }, [1, 2, 3].map((stage) => h('div', { class: 'card' }, [
      h('h3', { style: { marginTop: 0 } }, STAGES[stage].title),
      h('p', {}, STAGES[stage].lead),
    ]))),
  ]);
}

// ---------- Головна ----------

export async function home(app) {
  const { data, course } = await app.curriculum();
  const lang = app.lang;
  const progress = app.progress();
  const position = coursePosition(data, course, progress);
  const next = position.next;
  const opened = openedChars(data, course, progress, app.settings.freeAccess);
  const spots = weakSpots(app.profile.stats[lang], lang);
  const stageStats = [1, 2, 3].map((stage) => groupProgress(course.filter((exercise) => exercise.stage === stage), progress));
  const stageHref = { 1: '#/stage/1', 2: '#/stage/2', 3: '#/academy' };

  return h('div', {}, [
    h('div', { class: 'hero' }, [
      h('h1', {}, `Курс: ${LANG[lang].name} · ${LANG[lang].layout}`),
      h('p', { class: 'lead' }, 'Точність перед швидкістю: вправа зараховується лише тоді, коли пальці влучають стабільно.'),
    ]),
    h('div', { class: 'grid two' }, [
      h('div', { class: 'card' }, [
        h('h2', { style: { marginTop: 0 } }, next ? 'Продовжити навчання' : 'Курс пройдено'),
        next
          ? [
            h('p', {}, [h('span', { class: 'badge stage' }, STAGES[next.stage].title), ' ', h('span', { class: 'muted' }, next.groupTitle)]),
            h('p', {}, h('strong', {}, next.title)),
            h('p', { class: 'muted' }, next.goal),
            h('div', { class: 'actions' }, h('a', { class: 'button primary', href: `#/ex/${next.id}`, id: 'continue', dataset: { autofocus: 'true' } }, `Почати: ${next.title}`)),
          ]
          : h('p', {}, 'Усі вправи зараховано. Підтримуй форму темповими серіями й вправами на слабкі місця.'),
        h('p', { class: 'small muted' }, `Зараховано вправ: ${position.passed} з ${position.total} (${position.percent} %).`),
        progressBar(position.passed, position.total, 'Поступ курсу'),
      ]),
      h('div', { class: 'card' }, [
        h('h2', { style: { marginTop: 0 } }, 'Заняття на 15–25 хвилин'),
        h('p', {}, 'Готовий план на сьогодні: розігрів гамами, одна цільова навичка, закріплення слабких місць і справжній текст.'),
        h('div', { class: 'actions' }, [
          h('a', { class: 'button', href: '#/session' }, 'Відкрити план заняття'),
          h('a', { class: 'button', href: '#/weak' }, 'Слабкі місця'),
        ]),
        spots.keys.length
          ? h('p', {}, ['Найслабші клавіші зараз: ', keycaps(spots.keys.slice(0, 5).map((entry) => entry.ch).join(''))])
          : h('p', { class: 'muted' }, 'Слабкі клавіші з\'являться тут після перших залікових спроб.'),
      ]),
    ]),
    h('h2', {}, 'Три етапи'),
    h('div', { class: 'grid three' }, [1, 2, 3].map((stage) => h('div', { class: 'card' }, [
      h('h3', { style: { marginTop: 0 } }, h('a', { href: stageHref[stage] }, STAGES[stage].title)),
      h('p', {}, STAGES[stage].lead),
      h('p', { class: 'small muted' }, `Зараховано: ${stageStats[stage - 1].passed} з ${stageStats[stage - 1].total}`),
      progressBar(stageStats[stage - 1].passed, stageStats[stage - 1].total, `Поступ: ${STAGES[stage].title}`),
    ]))),
    h('h2', {}, 'Відкриті клавіші'),
    h('p', {}, app.settings.freeAccess
      ? 'Увімкнено вільний доступ: відкриті всі клавіші та вправи.'
      : 'Яскраві клавіші вже відкриті, притлумлені чекають на свій урок. Слова етапу 2 складаються лише з відкритих.'),
    renderKeyboard({ lang, opened: new Set(opened) }),
    fingerLegend(),
  ]);
}

// ---------- Етапи 1 і 2 ----------

export async function stage(app, number) {
  const { data, course } = await app.curriculum();
  const progress = app.progress();
  const byId = new Map(course.map((exercise) => [exercise.id, exercise]));
  const lessons = data.lessons
    .map((lesson) => ({ lesson, exercises: lesson.exercises.filter((exercise) => exercise.stage === number).map((exercise) => byId.get(exercise.id)) }))
    .filter((entry) => entry.exercises.length);
  const total = groupProgress(lessons.flatMap((entry) => entry.exercises), progress);

  return h('div', {}, [
    h('div', { class: 'hero' }, [
      h('h1', {}, STAGES[number].title),
      h('p', { class: 'lead' }, STAGES[number].lead),
      h('p', {}, [criterionLine(app.settings, number), ' Вправи відкриваються по черзі: етап 1 уроку, потім його слова, потім наступний урок.']),
      h('p', { class: 'small muted' }, `Зараховано: ${total.passed} з ${total.total}`),
      progressBar(total.passed, total.total, `Поступ: ${STAGES[number].title}`),
    ]),
    lessons.map(({ lesson, exercises }) => {
      const stat = groupProgress(exercises, progress);
      const keys = lesson.newKeys.filter((key) => key.length === 1).join('');
      return h('section', { class: 'card lesson', 'aria-labelledby': `${lesson.id}-title` }, [
        h('div', { class: 'lesson-head' }, [
          h('h2', { id: `${lesson.id}-title` }, `Урок ${lesson.n}. ${lesson.title}`),
          keys && lesson.kind === 'keys' && keycaps(keys),
          h('span', { class: `badge${stat.done ? ' ok' : ''}` }, `${stat.passed} з ${stat.total}`),
        ]),
        number === 2 && h('p', { class: 'small muted' }, ['Відкриті клавіші: ', h('span', { class: 'mono', dataset: { opened: lesson.opened } }, [...lesson.opened].filter((ch) => ch !== ' ' && ch === ch.toLowerCase()).join(' '))]),
        h('ul', { class: 'ex-list' }, exercises.map((exercise) => exerciseItem(app, course, exercise))),
      ]);
    }),
  ]);
}

// ---------- Етап 3: Академія ----------

export async function academy(app) {
  const { data, course } = await app.curriculum();
  const progress = app.progress();
  const byId = new Map(course.map((exercise) => [exercise.id, exercise]));
  const lessonsDone = groupProgress(course.filter((exercise) => exercise.stage < 3), progress);
  const all = groupProgress(course.filter((exercise) => exercise.stage === 3), progress);
  const locked = !app.settings.freeAccess && !lessonsDone.done;

  return h('div', {}, [
    h('div', { class: 'hero' }, [
      h('h1', {}, `${STAGES[3].title}: ${LANG[app.lang].adjective} мова`),
      h('p', { class: 'lead' }, STAGES[3].lead),
      h('p', {}, [
        criterionLine(app.settings, 3),
        ' Модуль завершено, коли зараховано всі його вправи; наступний модуль відкривається після попереднього.',
        ` У темпових серіях додатково потрібна швидкість не нижча за ${app.settings.tempoTargetSpm} зн/хв.`,
      ]),
      h('p', { class: 'small muted' }, `Зараховано: ${all.passed} з ${all.total}`),
      progressBar(all.passed, all.total, 'Поступ Академії'),
    ]),
    locked && h('div', { class: 'notice warn' }, [
      h('p', {}, [h('strong', {}, 'Академія ще закрита. '), `Вона відкриється після уроків етапів 1 і 2 (зараховано ${lessonsDone.passed} з ${lessonsDone.total}). Модулі та вправи нижче можна переглянути вже зараз.`]),
      h('p', {}, ['Уже набираєш наосліп? Пройди ', h('a', { href: '#/diagnostic' }, 'діагностику'), ' або ввімкни вільний доступ у ', h('a', { href: '#/settings' }, 'налаштуваннях'), '.']),
    ]),
    data.academy.map((module) => {
      const exercises = module.exercises.map((exercise) => byId.get(exercise.id));
      const stat = groupProgress(exercises, progress);
      return h('section', { class: 'card lesson', 'aria-labelledby': `${module.id}-title` }, [
        h('div', { class: 'lesson-head' }, [
          h('h2', { id: `${module.id}-title` }, `Модуль ${module.n}. ${module.title}`),
          h('span', { class: `badge${stat.done ? ' ok' : ''}` }, stat.done ? '✓ модуль завершено' : `${stat.passed} з ${stat.total}`),
        ]),
        h('p', {}, module.description),
        progressBar(stat.passed, stat.total, `Поступ модуля ${module.n}`),
        h('ul', { class: 'ex-list', style: { marginTop: '10px' } }, exercises.map((exercise) => exerciseItem(app, course, exercise))),
      ]);
    }),
  ]);
}

// ---------- Вправа курсу ----------

export async function exercise(app, id) {
  const { course } = await app.curriculum();
  const item = course.find((entry) => entry.id === id);
  if (!item) return notFound(app);
  const backHref = item.stage === 3 ? '#/academy' : `#/stage/${item.stage}`;
  const backLabel = STAGES[item.stage].title;
  if (!app.unlocked(course, id)) {
    const next = nextExercise(course, app.progress());
    return h('div', {}, [
      h('h1', {}, item.title),
      h('div', { class: 'notice warn' }, [
        h('p', {}, [h('strong', {}, 'Вправа ще закрита. '), 'Вона відкриється, коли буде зараховано всі попередні вправи.']),
        next && h('p', {}, ['Зараз на черзі: ', h('a', { href: `#/ex/${next.id}`, dataset: { autofocus: 'true' } }, next.title), '.']),
      ]),
      h('p', {}, h('a', { href: backHref }, `← ${backLabel}`)),
    ]);
  }
  return trainerView(app, item, { backHref, backLabel });
}

// ---------- Слабкі місця ----------

function weakIntro(app) {
  const spots = weakSpots(app.profile.stats[app.lang], app.lang);
  if (!spots.keys.length && !spots.transitions.length) return null;
  return h('div', { class: 'notice' }, h('p', {}, [
    'За твоєю статистикою: ',
    spots.keys.length ? ['слабкі клавіші ', keycaps(spots.keys.slice(0, 3).map((entry) => entry.ch).join('')), ' '] : '',
    spots.transitions.length ? ['повільні переходи ', spots.transitions.slice(0, 2).map((entry) => `«${entry.pair}»`).join(', ')] : '',
    '.',
  ]));
}

export async function weak(app) {
  const drill = await app.weakDrill();
  if (!drill) {
    return h('div', {}, [
      h('h1', {}, 'Слабкі місця'),
      h('p', {}, 'Поки що нема з чого зібрати вправу: пройди хоча б перший урок.'),
      h('p', {}, h('a', { href: '#/' }, '← На головну')),
    ]);
  }
  return trainerView(app, drill, {
    stageLabel: 'Адаптивна вправа',
    backHref: '#/stats', backLabel: 'Статистика',
    intro: weakIntro(app),
    onContinue: { label: 'Нова вправа на слабкі місця', run: () => app.go('#/weak') },
  });
}

export async function drill(app) {
  const pending = app.pendingDrill;
  if (!pending?.drill) return weak(app);
  return trainerView(app, pending.drill, {
    stageLabel: 'Адаптивна вправа',
    backHref: pending.ctx.backHref ?? '#/', backLabel: pending.ctx.backLabel ?? 'На головну',
    onContinue: pending.ctx.backHref ? { label: pending.ctx.backLabel, run: () => app.go(pending.ctx.backHref) } : null,
  });
}

// ---------- Діагностика ----------

export async function diagnostic(app) {
  const { data } = await app.curriculum();
  const lang = app.lang;
  const item = {
    id: 'diagnostic', stage: 3, kind: 'diagnostic', mechanical: false,
    title: 'Діагностика рівня',
    goal: 'Набери три речення так, як набираєш зазвичай. Програма виміряє швидкість і точність та порадить, з чого почати.',
    focus: '', texts: [data.diagnostic],
  };
  const finishOnboarding = (freeAccess, target) => {
    app.profile.onboarded[lang] = true;
    app.profile.settings.freeAccess = freeAccess;
    app.save();
    app.go(target);
  };
  return trainerView(app, item, {
    graded: false,
    stageLabel: 'Початкова діагностика',
    backHref: '#/start', backLabel: 'Вибір рівня',
    afterResult: ({ metrics }) => {
      const level = levelForSpm(metrics.spm);
      const ready = metrics.plausibility.ok && metrics.accuracy >= 95 && metrics.spm >= 100;
      return h('div', { class: 'card', id: 'diagnostic-advice' }, [
        h('h2', { style: { marginTop: 0 } }, 'Порада за діагностикою'),
        h('p', {}, `Твій темп відповідає рівню «${level.name}» (${fmt.int(metrics.spm)} зн/хв), точність ${fmt.pct(metrics.accuracy)}.`),
        ready
          ? h('p', {}, 'Ти вже набираєш упевнено. Радимо відкрити всі вправи й почати з Академії; до гам можна повернутися будь-коли.')
          : h('p', {}, metrics.accuracy < 95
            ? 'Точність нижча за 95 %: радимо почати з першого уроку й поставити пальці заново. Це швидше, ніж перевчати помилки на швидкості.'
            : 'Темп поки невисокий: радимо пройти курс по порядку — клавіші відкриватимуться поступово.'),
        h('div', { class: 'actions' }, ready
          ? [
            h('button', { type: 'button', class: 'primary', onclick: () => finishOnboarding(true, '#/academy') }, 'Відкрити все й перейти до Академії'),
            h('button', { type: 'button', onclick: () => finishOnboarding(false, '#/') }, 'Усе одно почати з першого уроку'),
          ]
          : [
            h('button', { type: 'button', class: 'primary', onclick: () => finishOnboarding(false, '#/') }, 'Почати з першого уроку'),
            h('button', { type: 'button', onclick: () => finishOnboarding(true, '#/academy') }, 'Усе одно відкрити всі вправи'),
          ]),
      ]);
    },
  });
}

// ---------- Заняття на 15–25 хвилин ----------

async function buildSession(app) {
  const { data, course } = await app.curriculum();
  const progress = app.progress();
  const next = nextExercise(course, progress);
  const passed = course.filter((exercise) => isPassed(progress, exercise.id));
  const allOpen = app.settings.freeAccess || !next || next.stage === 3;

  const warmup = passed.filter((exercise) => exercise.stage === 1 && exercise.kind === 'scale').at(-1)
    ?? passed.filter((exercise) => exercise.stage === 1).at(-1)
    ?? course[0];
  const target = next ?? course.filter((exercise) => exercise.tempo).at(-1);
  const drillExercise = await app.weakDrill();

  let text;
  if (allOpen) {
    const sentences = data.academy.find((module) => module.exercises.some((exercise) => exercise.kind === 'sentences'));
    const pool = sentences.exercises.flatMap((exercise) => exercise.texts);
    text = { id: 'session-text', stage: 3, kind: 'sentences', mechanical: false, title: 'Справжній текст: речення', goal: 'Перенесення навички в зв\'язний текст. Набирай рівно, не зупиняючись між словами.', focus: '', texts: [pool[app.profile.history.length % pool.length]] };
  } else {
    const words = passed.filter((exercise) => exercise.stage === 2).at(-1);
    text = words
      ? { ...words, id: 'session-text', group: undefined, title: `Справжні слова: ${words.title.toLowerCase()}`, goal: 'Слова лише з відкритих клавіш: перенесення рухів у справжню мову.' }
      : { ...warmup, id: 'session-text', group: undefined, title: 'Гама відкритих клавіш', goal: 'Справжні слова з\'являться, щойно відкриється більше клавіш. Поки що закріплюємо гаму.' };
  }

  const steps = [
    { name: 'Розігрів', minutes: 3, rounds: 2, exercise: warmup, note: 'Знайома гама: згадати домашній ряд і рівний ритм.' },
    { name: 'Цільова навичка', minutes: 8, rounds: Math.max(3, app.settings.streakToPass), exercise: target, note: 'Одна нова навичка заняття — наступна вправа курсу.' },
    drillExercise && { name: 'Закріплення', minutes: 5, rounds: 2, exercise: drillExercise, note: 'Вправа, зібрана за твоїми помилками й повільними переходами.' },
    { name: 'Справжній текст', minutes: 5, rounds: 2, exercise: text, note: 'Перенесення навички у слова та речення.' },
  ].filter(Boolean);
  return { lang: app.lang, steps, index: 0, round: 0, done: false };
}

export async function session(app) {
  if (!app.session || app.session.lang !== app.lang || app.session.done) app.session = await buildSession(app);
  const plan = app.session;
  const minutes = plan.steps.reduce((sum, step) => sum + step.minutes, 0);
  const started = plan.index > 0 || plan.round > 0;
  return h('div', {}, [
    h('div', { class: 'hero' }, [
      h('h1', {}, 'Заняття на сьогодні'),
      h('p', { class: 'lead' }, `Близько ${minutes} хвилин: розігрів, одна цільова навичка, закріплення і справжній текст. Краще коротко щодня, ніж довго раз на тиждень.`),
    ]),
    h('ol', { class: 'steps' }, plan.steps.map((step, i) => h('li', { class: i < plan.index ? 'done' : i === plan.index ? 'current' : '' }, h('div', {}, [
      h('strong', {}, `${step.name} · ≈ ${step.minutes} хв · ${step.rounds} ${step.rounds === 2 ? 'спроби' : step.rounds < 5 ? 'спроби' : 'спроб'}`),
      h('div', {}, step.exercise.title),
      h('div', { class: 'muted small' }, step.note),
      i === plan.index && started && h('div', { class: 'small' }, `Виконано спроб: ${plan.round} з ${step.rounds}`),
    ])))),
    h('div', { class: 'actions' }, [
      h('a', { class: 'button primary', href: '#/session/run', dataset: { autofocus: 'true' } }, started ? 'Продовжити заняття' : 'Почати заняття'),
      started && h('button', { type: 'button', onclick: () => { app.session = null; app.render(); } }, 'Скласти план заново'),
    ]),
  ]);
}

export async function sessionRun(app) {
  if (!app.session || app.session.lang !== app.lang) app.session = await buildSession(app);
  const plan = app.session;
  if (plan.done) {
    return h('div', {}, [
      h('h1', {}, 'Заняття завершено'),
      h('div', { class: 'notice ok' }, h('p', {}, 'Усі кроки плану виконано. Повертайся завтра: регулярність важливіша за тривалість.')),
      h('div', { class: 'actions' }, [
        h('a', { class: 'button primary', href: '#/stats', dataset: { autofocus: 'true' } }, 'Переглянути статистику'),
        h('a', { class: 'button', href: '#/' }, 'На головну'),
      ]),
    ]);
  }
  const step = plan.steps[plan.index];
  const advance = () => {
    plan.round += 1;
    if (plan.round >= step.rounds) {
      plan.round = 0;
      plan.index += 1;
      if (plan.index >= plan.steps.length) plan.done = true;
    }
    app.render();
  };
  const last = plan.index === plan.steps.length - 1 && plan.round === step.rounds - 1;
  return trainerView(app, step.exercise, {
    stageLabel: `Заняття · крок ${plan.index + 1} з ${plan.steps.length}: ${step.name}`,
    backHref: '#/session', backLabel: 'План заняття',
    intro: h('div', { class: 'notice' }, h('p', {}, `${step.note} Спроба ${plan.round + 1} з ${step.rounds}.`)),
    continueAlways: true,
    onContinue: { label: last ? 'Завершити заняття' : 'Далі за планом заняття', run: advance },
  });
}

// ---------- Статистика ----------

function historyChart(items) {
  const width = 720;
  const height = 220;
  const left = 44;
  const right = width - 44;
  const top = 16;
  const bottom = height - 30;
  const maxSpm = Math.max(100, ...items.map((item) => item.spm));
  const x = (i) => (items.length === 1 ? (left + right) / 2 : left + (i / (items.length - 1)) * (right - left));
  const ySpm = (value) => bottom - (value / maxSpm) * (bottom - top);
  const yAcc = (value) => bottom - ((Math.max(80, value) - 80) / 20) * (bottom - top);
  const path = (fn, key) => items.map((item, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${fn(item[key]).toFixed(1)}`).join(' ');
  return svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Графік останніх спроб: суцільна лінія — швидкість, штрихова — точність. Ті самі дані наведено в таблиці нижче.' }, [
    svg('line', { class: 'axis', x1: left, y1: bottom, x2: right, y2: bottom }),
    svg('line', { class: 'axis', x1: left, y1: top, x2: left, y2: bottom }),
    svg('line', { class: 'axis', x1: right, y1: top, x2: right, y2: bottom }),
    svg('text', { x: left - 6, y: top + 4, 'text-anchor': 'end' }, String(Math.round(maxSpm))),
    svg('text', { x: left - 6, y: bottom, 'text-anchor': 'end' }, '0'),
    svg('text', { x: right + 6, y: top + 4 }, '100 %'),
    svg('text', { x: right + 6, y: bottom }, '80 %'),
    svg('text', { x: left, y: height - 8 }, '— швидкість, зн/хв'),
    svg('text', { x: right, y: height - 8, 'text-anchor': 'end' }, '- - точність, %'),
    svg('path', { class: 'line', d: path(ySpm, 'spm') }),
    svg('path', { class: 'line acc', d: path(yAcc, 'accuracy') }),
    items.map((item, i) => svg('circle', { class: 'dot', cx: x(i).toFixed(1), cy: ySpm(item.spm).toFixed(1), r: 3 })),
  ]);
}

export async function stats(app) {
  const lang = app.lang;
  const history = app.profile.history.filter((item) => item.lang === lang);
  const recent = history.slice(-30);
  const spots = weakSpots(app.profile.stats[lang], lang, { limit: 8 });
  const keyStats = app.profile.stats[lang].keys;

  // Карта помилок: частка помилок на фізичну клавішу.
  const heat = new Map();
  for (const [ch, entry] of Object.entries(keyStats)) {
    const info = keyInfo(ch, lang);
    if (!info || entry.n < 1) continue;
    const current = heat.get(info.code) ?? { n: 0, errors: 0 };
    current.n += entry.n;
    current.errors += entry.err;
    heat.set(info.code, current);
  }
  for (const entry of heat.values()) entry.rate = entry.errors / Math.max(entry.n, 1);

  const last10 = history.slice(-10);
  const avg = (key) => (last10.length ? last10.reduce((sum, item) => sum + item[key], 0) / last10.length : 0);
  const tile = (label, value, sub) => h('div', { class: 'tile' }, [h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub' }, sub)]);

  if (!history.length) {
    return h('div', {}, [
      h('h1', {}, `Статистика: ${LANG[lang].adjective} мова`),
      h('p', {}, 'Тут з\'являться швидкість, точність, карта помилок і повільні переходи — після першої залікової спроби.'),
      h('div', { class: 'actions' }, h('a', { class: 'button primary', href: '#/', dataset: { autofocus: 'true' } }, 'До навчання')),
    ]);
  }

  return h('div', {}, [
    h('h1', {}, `Статистика: ${LANG[lang].adjective} мова`),
    h('div', { class: 'tiles' }, [
      tile('Залікових спроб', String(history.length), `зараховано ${history.filter((item) => item.passed).length}`),
      tile('Середня швидкість', `${fmt.int(avg('spm'))} зн/хв`, 'останні 10 спроб'),
      tile('Середня точність', fmt.pct(avg('accuracy')), 'останні 10 спроб'),
      tile('Найкраща швидкість', `${fmt.int(Math.max(...history.filter((item) => item.passed).map((item) => item.spm), 0))} зн/хв`, 'серед зарахованих спроб'),
      tile('Час набору', formatDuration(history.reduce((sum, item) => sum + item.ms, 0)), 'усі залікові спроби'),
    ]),
    h('h2', {}, 'Динаміка'),
    historyChart(recent),
    h('h2', {}, 'Карта помилок'),
    h('p', {}, 'Відсоток на клавіші — частка помилкових натискань. Смужка внизу клавіші: вузька — помилки трапляються, широка — понад 12 %.'),
    renderKeyboard({ lang, heat }),
    h('div', { class: 'grid two' }, [
      h('div', {}, [
        h('h2', {}, 'Слабкі клавіші'),
        spots.keys.length
          ? h('div', { class: 'table-scroll' }, h('table', {}, [
            h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Клавіша'), h('th', { scope: 'col' }, 'Палець'), h('th', { scope: 'col', class: 'num' }, 'Помилок'), h('th', { scope: 'col', class: 'num' }, 'Пауза')])),
            h('tbody', {}, spots.keys.map((entry) => h('tr', {}, [
              h('td', {}, h('span', { class: 'keycap' }, entry.ch)),
              h('td', {}, FINGER_NAME(entry.ch, lang)),
              h('td', { class: 'num' }, fmt.pct(entry.errorRate * 100)),
              h('td', { class: 'num' }, entry.avgMs ? `${fmt.int(entry.avgMs)} мс` : '—'),
            ]))),
          ]))
          : h('p', { class: 'muted' }, 'Явно слабких клавіш поки не видно.'),
      ]),
      h('div', {}, [
        h('h2', {}, 'Повільні переходи'),
        spots.transitions.length
          ? h('div', { class: 'table-scroll' }, h('table', {}, [
            h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Перехід'), h('th', { scope: 'col' }, 'Характер руху'), h('th', { scope: 'col', class: 'num' }, 'Пауза'), h('th', { scope: 'col', class: 'num' }, 'Відносно типової')])),
            h('tbody', {}, spots.transitions.map((entry) => h('tr', {}, [
              h('td', {}, keycaps(entry.pair)),
              h('td', {}, entry.kind),
              h('td', { class: 'num' }, `${fmt.int(entry.avgMs)} мс`),
              h('td', { class: 'num' }, `×${fmt.one(entry.ratio)}`),
            ]))),
          ]))
          : h('p', { class: 'muted' }, 'Помітно повільних переходів поки немає.'),
      ]),
    ]),
    h('div', { class: 'actions' }, h('a', { class: 'button primary', href: '#/weak' }, 'Вправа на слабкі місця')),
    h('h2', {}, 'Останні спроби'),
    h('div', { class: 'table-scroll' }, h('table', { id: 'history-table' }, [
      h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Вправа'), h('th', { scope: 'col', class: 'num' }, 'зн/хв'), h('th', { scope: 'col', class: 'num' }, 'Точність'), h('th', { scope: 'col', class: 'num' }, 'Помилок'), h('th', { scope: 'col', class: 'num' }, 'Час'), h('th', { scope: 'col' }, 'Залік')])),
      h('tbody', {}, recent.slice().reverse().map((item) => h('tr', {}, [
        h('td', {}, item.title),
        h('td', { class: 'num' }, fmt.int(item.spm)),
        h('td', { class: 'num' }, fmt.pct(item.accuracy)),
        h('td', { class: 'num' }, String(item.errors)),
        h('td', { class: 'num' }, formatDuration(item.ms)),
        h('td', {}, item.passed ? '✓ так' : '✗ ні'),
      ]))),
    ])),
  ]);
}

const FINGER_NAMES = { L5: 'лівий мізинець', L4: 'лівий безіменний', L3: 'лівий середній', L2: 'лівий вказівний', R2: 'правий вказівний', R3: 'правий середній', R4: 'правий безіменний', R5: 'правий мізинець', T: 'великий' };
function FINGER_NAME(ch, lang) {
  const info = keyInfo(ch, lang);
  return info ? FINGER_NAMES[KEYS[info.code].finger] : '';
}

// ---------- Налаштування ----------

export async function settings(app) {
  const s = app.settings;
  const update = (mutate) => {
    mutate(app.profile.settings);
    app.save();
    app.applySettings();
  };
  const numberField = (id, label, hint, value, limits, onChange, suffix) => h('div', { class: 'field' }, [
    h('label', { for: id }, label),
    h('span', {}, [
      h('input', {
        id, type: 'number', value: String(value), min: String(limits.min), max: String(limits.max), step: '1', inputmode: 'numeric',
        onchange: (event) => {
          const next = onChange(event.target.value);
          event.target.value = String(next);
        },
      }),
      suffix ? ` ${suffix}` : '',
    ]),
    h('span', { class: 'hint' }, hint),
  ]);
  const checkbox = (id, label, hint, checked, onChange) => h('div', { class: 'check' }, [
    h('input', { id, type: 'checkbox', checked: checked ? true : null, onchange: (event) => onChange(event.target.checked) }),
    h('span', {}, [h('label', { for: id }, label), h('span', { class: 'muted small' }, hint)]),
  ]);
  const select = (id, label, value, options, onChange) => h('div', { class: 'field' }, [
    h('label', { for: id }, label),
    h('select', { id, onchange: (event) => onChange(event.target.value) }, options.map(([key, name]) => h('option', { value: key, selected: key === value ? true : null }, name))),
  ]);
  const message = h('p', { role: 'status', 'aria-live': 'polite' });
  const fileInput = h('input', {
    type: 'file', id: 'import-file', accept: 'application/json,.json', style: { display: 'none' },
    onchange: async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        app.profile = importProfile(await file.text());
        app.save();
        app.session = null;
        app.render();
      } catch (error) {
        message.textContent = `Імпорт не вдався: ${error.message}`;
      }
    },
  });
  const sample = h('p', { class: 'type-text', lang: app.lang }, app.lang === 'uk' ? 'фіва олдж — зразок тексту вправи' : 'asdf jkl; — sample exercise text');

  return h('div', {}, [
    h('h1', {}, 'Налаштування'),
    h('fieldset', {}, [
      h('legend', {}, 'Критерії заліку'),
      h('p', { class: 'muted' }, 'Усі пороги можна змінити. Точність має пріоритет: жодне налаштування не дозволяє зарахувати вправу лише за швидкістю.'),
      [1, 2, 3].map((stageNumber) => numberField(`acc-${stageNumber}`, `Мінімальна точність, етап ${stageNumber}`, `Типово ${DEFAULT_SETTINGS.minAccuracy[stageNumber]} %. Допустимо ${SETTING_LIMITS.minAccuracy.min}–${SETTING_LIMITS.minAccuracy.max} %.`, s.minAccuracy[stageNumber], SETTING_LIMITS.minAccuracy, (value) => {
        const next = clampSetting('minAccuracy', value);
        update((settingsDraft) => { settingsDraft.minAccuracy[stageNumber] = next; });
        return next;
      }, '%')),
      numberField('streak', 'Успішних спроб поспіль для завершення вправи', `Типово ${DEFAULT_SETTINGS.streakToPass}. Допустимо ${SETTING_LIMITS.streakToPass.min}–${SETTING_LIMITS.streakToPass.max}.`, s.streakToPass, SETTING_LIMITS.streakToPass, (value) => {
        const next = clampSetting('streakToPass', value);
        update((settingsDraft) => { settingsDraft.streakToPass = next; });
        return next;
      }),
      numberField('tempo', 'Цільова швидкість темпових серій', `Типово ${DEFAULT_SETTINGS.tempoTargetSpm} зн/хв (рівень «Впевнений»). Діє лише в модулі «Темпові серії» й лише разом із точністю.`, s.tempoTargetSpm, SETTING_LIMITS.tempoTargetSpm, (value) => {
        const next = clampSetting('tempoTargetSpm', value);
        update((settingsDraft) => { settingsDraft.tempoTargetSpm = next; });
        return next;
      }, 'зн/хв'),
    ]),
    h('fieldset', {}, [
      h('legend', {}, 'Набір'),
      checkbox('stop-on-error', 'Зупинка на помилці', 'Увімкнено: курсор не рухається, доки не натиснуто правильну клавішу. Вимкнено: хибний символ вставляється, його виправляють клавішею Backspace. Помилка рахується в обох режимах.', s.stopOnError, (value) => update((d) => { d.stopOnError = value; })),
      checkbox('free-access', 'Вільний доступ до всіх вправ', 'Для тих, хто вже набирає наосліп: усі уроки й модулі відкриті одразу. Залік кожної вправи рахується як завжди.', s.freeAccess, (value) => update((d) => { d.freeAccess = value; })),
    ]),
    h('fieldset', {}, [
      h('legend', {}, 'Вигляд і звук'),
      h('div', { class: 'field' }, [
        h('label', { for: 'font-size' }, 'Розмір тексту вправи'),
        h('input', {
          id: 'font-size', type: 'range', min: String(SETTING_LIMITS.fontSize.min), max: String(SETTING_LIMITS.fontSize.max), step: '2', value: String(s.fontSize),
          oninput: (event) => {
            update((d) => { d.fontSize = clampSetting('fontSize', event.target.value); });
            sizeLabel.textContent = `${app.settings.fontSize} px`;
          },
        }),
        h('span', { class: 'hint' }, ['Зараз: ', (() => { sizeLabel.textContent = `${s.fontSize} px`; return sizeLabel; })(), '. Від 20 до 44 px.']),
      ]),
      sample,
      select('theme', 'Тема', s.theme, [['auto', 'Як у системі'], ['light', 'Світла'], ['dark', 'Темна']], (value) => update((d) => { d.theme = value; })),
      select('motion', 'Анімації', s.motion, [['auto', 'Як у системі (враховує «зменшення руху»)'], ['off', 'Вимкнено']], (value) => update((d) => { d.motion = value; })),
      checkbox('sound', 'Звук помилки', 'Короткий тихий сигнал на хибне натискання. Типово вимкнено.', s.sound, (value) => update((d) => { d.sound = value; })),
    ]),
    h('fieldset', {}, [
      h('legend', {}, 'Профіль і дані'),
      h('p', {}, 'Прогрес зберігається лише в цьому браузері (localStorage). Файл профілю дає змогу перенести його на інший комп\'ютер.'),
      h('div', { class: 'actions' }, [
        h('button', {
          type: 'button', id: 'export-profile',
          onclick: () => {
            const blob = new Blob([exportProfile(app.profile)], { type: 'application/json' });
            const link = h('a', { href: URL.createObjectURL(blob), download: `gamy-profile-${new Date().toISOString().slice(0, 10)}.json` });
            link.click();
            URL.revokeObjectURL(link.href);
            message.textContent = 'Профіль експортовано у файл.';
          },
        }, 'Експортувати профіль у файл'),
        h('button', { type: 'button', onclick: () => fileInput.click() }, 'Імпортувати профіль із файлу'),
        fileInput,
        h('button', { type: 'button', onclick: () => app.go('#/start') }, 'Обрати рівень заново'),
      ]),
      h('div', { class: 'actions' }, resetControl(app)),
      message,
    ]),
  ]);
}

const sizeLabel = h('strong', {});

function resetControl(app) {
  const holder = h('span', {});
  const ask = () => {
    holder.replaceChildren(
      h('span', { class: 'notice bad', style: { display: 'inline-flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', margin: 0 } }, [
        'Видалити весь прогрес і статистику обома мовами? Скасувати це не можна.',
        h('button', {
          type: 'button', class: 'danger', id: 'reset-confirm',
          onclick: () => {
            app.profile = createProfile();
            app.session = null;
            app.save();
            app.go('#/');
          },
        }, 'Так, видалити'),
        h('button', { type: 'button', onclick: () => { holder.replaceChildren(button); button.focus(); } }, 'Скасувати'),
      ]),
    );
    holder.querySelector('button:last-child').focus();
  };
  const button = h('button', { type: 'button', class: 'danger', id: 'reset-profile', onclick: ask }, 'Видалити профіль');
  holder.append(button);
  return holder;
}

// ---------- Джерела та ліцензії ----------

export async function sources(app) {
  const [manifest, report] = await Promise.all([app.fetchJson('dictionaries/manifest.json'), app.fetchJson('data/derived/build-report.json')]);
  const langName = { en: 'англійська', uk: 'українська', ru: 'російська (лише фільтр)' };
  return h('div', {}, [
    h('h1', {}, 'Джерела та ліцензії'),
    h('p', { class: 'lead' }, 'Усі слова у вправах походять зі словників із відкритими ліцензіями. Сировина зберігається в репозиторії без змін разом із файлами ліцензій; очищені списки будує відтворюваний скрипт.'),
    h('h2', {}, 'Словники (незмінна сировина)'),
    h('div', { class: 'table-scroll' }, h('table', { id: 'sources-table' }, [
      h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Набір'), h('th', { scope: 'col' }, 'Мова'), h('th', { scope: 'col' }, 'Джерело й ревізія'), h('th', { scope: 'col' }, 'Ліцензія'), h('th', { scope: 'col' }, 'Як використано')])),
      h('tbody', {}, manifest.datasets.map((dataset) => h('tr', {}, [
        h('th', { scope: 'row' }, dataset.title),
        h('td', {}, langName[dataset.language]),
        h('td', {}, [h('a', { href: dataset.source, rel: 'noopener' }, dataset.source.replace('https://', '')), h('div', { class: 'small muted mono' }, `ревізія ${dataset.revision.slice(0, 12)}`)]),
        h('td', {}, [dataset.license, h('div', { class: 'small' }, h('a', { href: `dictionaries/${dataset.licenseFile}` }, 'текст ліцензії'))]),
        h('td', {}, dataset.usage),
      ]))),
    ])),
    h('p', { class: 'small muted' }, `Контрольні суми SHA-256 кожного файлу записані в dictionaries/manifest.json і перевіряються автоматичним тестом. Знімок джерел: ${manifest.snapshotDate}.`),

    h('h2', {}, 'Як очищено словники'),
    h('p', {}, `Скрипт scripts/build-data.mjs (версія алгоритму ${report.algorithmVersion}) читає сировину й записує data/derived/. Повторний запуск на тих самих файлах дає ті самі байти — це перевіряє тест.`),
    ['uk', 'en'].map((lang) => {
      const info = report.languages[lang];
      return h('div', { class: 'card' }, [
        h('h3', { style: { marginTop: 0 } }, `${lang === 'uk' ? 'Українська' : 'Англійська'}: похідний словник під ліцензією ${info.license}`),
        h('div', { class: 'table-scroll' }, h('table', {}, [
          h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Крок'), h('th', { scope: 'col' }, 'Що робить'), h('th', { scope: 'col', class: 'num' }, 'Записів після кроку')])),
          h('tbody', {}, info.steps.map((step) => h('tr', {}, [h('td', { class: 'mono' }, step.step), h('td', {}, step.description), h('td', { class: 'num' }, String(step.records))]))),
        ])),
      ]);
    }),
    h('div', { class: 'notice' }, [
      h('p', {}, [h('strong', {}, 'Про GPL. '), 'Український список перевіряється за Hunspell-словником brown-uk/dict_uk (GPL-3.0), тому похідні файли data/derived/uk/ і data/curriculum/uk.json поширюються на умовах GPL-3.0-or-later. Англійські похідні дані — MIT. Код програми — MIT; дані різних ліцензій лежать в окремих файлах і не змішуються.']),
      h('p', {}, [h('strong', {}, 'Про російський список. '), 'Український частотний список зібрано із субтитрів, серед яких багато російських. Російський список того самого джерела використано лише як «негативний» фільтр: за ним обчислюється, яку частку вживань слова пояснюють російські субтитри, і такі слова вилучаються. Жодне слово з нього у вправи не потрапляє.']),
    ]),

    h('h2', {}, 'Нормалізація'),
    h('ul', {}, [
      h('li', {}, 'Unicode NFC, нижній регістр для словникових слів.'),
      h('li', {}, ['Апостроф: варіанти ', h('span', { class: 'mono' }, '’ ʼ ‘ `'), ' зводяться до ', h('span', { class: 'mono' }, "'"), ' (U+0027) — і в словнику, і в набраному тексті.']),
      h('li', {}, 'Літери і, ї, є, ґ не замінюються ніколи: «г» замість «ґ» чи латинська «i» замість «і» — це помилка набору.'),
      h('li', {}, 'Власні назви, уламки слів, звуконаслідування й неприйнятна лексика відсіюються (data/filters/).'),
    ]),

    h('h2', {}, 'Тексти речень і абзаців'),
    h('p', {}, 'Речення, абзаци та приклади з розділовими знаками й числами (data/texts/) написано спеціально для цього тренажера й передано в суспільне надбання (CC0-1.0). Тексти диктантів, книжок і сайтів не використовувалися.'),

    h('h2', {}, 'Частотність і n-грами'),
    h('p', {}, 'Вага біграми чи триграми дорівнює сумі частот слів, у яких вона трапляється. Це частотність усередині слів; переходи між словами не оцінюються, бо для них потрібен окремий корпус.'),

    h('h2', {}, 'Що не використано'),
    h('p', {}, 'Набори організатора без підтвердженої відкритої ліцензії (вправи TT, копії Typing-race-2026, радіодиктанти) у продукт не включено.'),

    h('h2', {}, 'Приватність'),
    h('p', {}, 'Програма — статичний сайт без сервера, реєстрації, аналітики й сторонніх скриптів. Прогрес зберігається лише в localStorage цього браузера. AI у готовому продукті не використовується: усі вправи зібрано заздалегідь або генеруються локально за правилами.'),
  ]);
}

// ---------- Метод і пальці ----------

export async function help(app) {
  return h('div', {}, [
    h('h1', {}, 'Метод і розподіл пальців'),
    h('p', { class: 'lead' }, 'Сенсорний набір — це набір без пошуку клавіш очима. Кожна клавіша має свій палець, пальці стартують із домашнього ряду й повертаються на нього після кожного натискання.'),
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 } }, 'П\'ять правил'),
      h('ol', {}, [
        h('li', {}, 'Одна фізична клавіша — один визначений палець.'),
        h('li', {}, ['Пальці лежать на домашньому ряді: ', h('span', { class: 'mono' }, `${HOME_ROW.uk.left.toUpperCase()} ${HOME_ROW.uk.right.toUpperCase()}`), ' в українській розкладці, ', h('span', { class: 'mono' }, `${HOME_ROW.en.left.toUpperCase()} ${HOME_ROW.en.right.toUpperCase()}`), ' в англійській. Вказівні відчувають виступи на клавішах F/А та J/О.']),
        h('li', {}, 'Після натискання палець повертається на свою домашню клавішу. Кисті лишаються на місці, рухаються пальці.'),
        h('li', {}, 'Погляд — на екрані. Пробіл натискає великий палець, Shift — мізинець руки, протилежної літері.'),
        h('li', {}, 'Швидкість нарощується лише після стабільної точності й рівного ритму.'),
      ]),
      h('p', { class: 'muted' }, 'Програма не стежить за поглядом і не використовує камеру. Підглядання стає зайвим завдяки побудові вправ: клавіші відкриваються по дві, а під час заліку на екрані немає клавіатури й підказок.'),
    ]),
    ['uk', 'en'].map((lang) => h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 } }, `${LANG[lang].name}: розкладка ${LANG[lang].layout}`),
      renderKeyboard({ lang }),
      fingerLegend(),
      fingerTable(lang),
      lang === 'uk' && h('p', { class: 'muted small' }, 'Схему подано для розкладки «Українська (розширена)»: апостроф — клавіша ліворуч від 1, ґ — правий Alt (AltGr) + Г. На інших системах ці два символи можуть бути на сусідніх клавішах; програма перевіряє сам набраний символ.'),
    ])),
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 } }, 'Три етапи навчання'),
      h('ol', {}, [1, 2, 3].map((stage) => h('li', {}, [h('strong', {}, `${STAGES[stage].title}. `), STAGES[stage].lead]))),
      h('p', {}, 'Складність зростає так: клавіші → пари клавіш → склади й морфеми → слова → словосполучення → речення → суцільний текст → темпові серії.'),
    ]),
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 } }, 'Як рахуються метрики'),
      h('ul', {}, [
        h('li', {}, [h('strong', {}, 'Швидкість, зн/хв (SPM) '), '= 60 · N / T, де N — кількість символів вправи, T — секунди від першого до останнього натискання.']),
        h('li', {}, [h('strong', {}, 'Точність '), '= (N − E) / N · 100 %, де E — усі помилкові натискання. Виправлена помилка лишається в статистиці назавжди.']),
        h('li', {}, [h('strong', {}, 'WPM '), '= SPM / 5 — додаткова метрика.']),
        h('li', {}, [h('strong', {}, 'Нерівномірність ритму '), '= відхилення пауз між натисканнями відносно середньої паузи. Менше — рівніше.']),
        h('li', {}, `Спроба, набрана швидше за ${PLAUSIBILITY.maxSpm} зн/хв або з паузами коротшими за ${PLAUSIBILITY.minMedianIntervalMs} мс, не зараховується: так не набирає людина. Вставка тексту з буфера відхиляється.`),
      ]),
      h('div', { class: 'table-scroll' }, h('table', {}, [
        h('caption', {}, 'Орієнтири рівнів'),
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Рівень'), h('th', { scope: 'col', class: 'num' }, 'Швидкість, зн/хв'), h('th', { scope: 'col', class: 'num' }, 'Мінімальна точність'), h('th', { scope: 'col' }, 'Основна мета')])),
        h('tbody', {}, LEVELS.map((level) => h('tr', {}, [
          h('th', { scope: 'row' }, level.name),
          h('td', { class: 'num' }, level.spm[1] === Infinity ? `${level.spm[0]}+` : level.spm[0] === 0 ? 'без вимоги' : `${level.spm[0]}–${level.spm[1]}`),
          h('td', { class: 'num' }, `${level.minAccuracy} %`),
          h('td', {}, level.goal),
        ]))),
      ])),
      h('p', { class: 'muted' }, 'Для початківця швидкість ніде не блокує навчання: на етапах 1 і 2 залік залежить лише від точності.'),
    ]),
    h('div', { class: 'card' }, [
      h('h2', { style: { marginTop: 0 } }, 'Керування з клавіатури'),
      h('ul', {}, [
        h('li', {}, [h('kbd', {}, 'Tab'), ' / ', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Tab'), ' — перехід між кнопками й посиланнями; ', h('kbd', {}, 'Enter'), ' — натиснути.']),
        h('li', {}, ['На екрані вправи фокус одразу стоїть на кнопці «Почати залік»: досить натиснути ', h('kbd', {}, 'Enter'), ' і набирати.']),
        h('li', {}, [h('kbd', {}, 'Esc'), ' під час набору — вийти з вправи. Після спроби фокус стоїть на рекомендованій наступній дії.']),
      ]),
    ]),
  ]);
}

export function notFound() {
  return h('div', {}, [
    h('h1', {}, 'Сторінку не знайдено'),
    h('p', {}, h('a', { href: '#/', dataset: { autofocus: 'true' } }, 'На головну')),
  ]);
}
