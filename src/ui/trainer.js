// Тренувальний екран: вступ зі схемою пальців → набір (залік без підказок або тренування) → результат.

import { analyzeAttempt, recommend, updateStats } from '../core/analysis.js';
import { CHAR_STATE, TypingSession } from '../core/engine.js';
import { describeKey, displayChar, keyInfo } from '../core/layouts.js';
import { formatDuration, judgeAttempt } from '../core/metrics.js';
import { exerciseRecord, recordAttempt, thresholdsFor } from '../core/progress.js';
import { addHistory } from '../core/storage.js';
import { fmt, h, keycaps, mount, svg } from './dom.js';
import { fingerLegend, renderKeyboard } from './keyboard.js';

const STAGE_NAMES = {
  1: 'Етап 1 · Клавіатурні гами',
  2: 'Етап 2 · Слова з вивчених клавіш',
  3: 'Етап 3 · Академія',
};
const LANG_NAMES = { uk: 'українська', en: 'англійська' };
const LANG_INSTRUMENTAL = { uk: 'українською', en: 'англійською' };
const show = (ch) => `«${displayChar(ch)}»`;

let audioContext = null;
function beep() {
  try {
    audioContext ??= new AudioContext();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = 220;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.07);
  } catch { /* звук недоступний — не критично */ }
}

/**
 * @param {object} app      застосунок (профіль, збереження, навігація)
 * @param {object} exercise вправа курсу або згенерована вправа
 * @param {object} [ctx]    { backHref, backLabel, onContinue: {label, run}, afterResult(node, data) }
 */
export function trainerView(app, exercise, ctx = {}) {
  const { profile } = app;
  const lang = app.lang;
  const settings = profile.settings;
  const root = h('div', { class: 'trainer' });
  const isCourse = exercise.group !== undefined;
  const thresholds = thresholdsFor(exercise, settings);
  const record = () => exerciseRecord(profile.progress[lang], exercise.id);
  const pickText = () => exercise.texts[record().variant % exercise.texts.length];

  const stageBadge = () => h('span', { class: 'badge stage' }, ctx.stageLabel ?? STAGE_NAMES[exercise.stage]);
  const back = () => h('p', { class: 'small' }, h('a', { href: ctx.backHref ?? '#/' }, `← ${ctx.backLabel ?? 'На головну'}`));

  function criterionText() {
    const parts = [`точність не нижча за ${thresholds.minAccuracy} %`];
    if (thresholds.targetSpm) parts.push(`швидкість не нижча за ${thresholds.targetSpm} зн/хв`);
    return parts.join(' і ');
  }

  // ---------- Вступ ----------

  function renderIntro() {
    const rec = record();
    const focus = [...new Set(exercise.focus ?? '')].filter((ch) => keyInfo(ch, lang));
    const opened = exercise.opened ? new Set(exercise.opened) : null;
    const start = h('button', { class: 'primary', type: 'button', id: 'start-graded', dataset: { autofocus: 'true' }, onclick: () => renderTyping(true) }, 'Почати залік (без підказок)');
    const text = pickText();

    mount(root,
      back(),
      h('div', { class: 'trainer-head' }, [
        h('h1', {}, exercise.title),
        stageBadge(),
        exercise.mechanical && h('span', { class: 'badge' }, 'Механіка: це рухи, а не слова'),
        rec.passed && h('span', { class: 'badge ok' }, '✓ зараховано'),
      ]),
      ctx.intro ?? null,
      h('p', { class: 'lead' }, exercise.goal),
      h('div', { class: 'card' }, [
        h('h2', { style: { marginTop: 0 } }, 'Текст вправи'),
        h('p', { class: 'type-text', lang, id: 'exercise-preview' }, text),
        h('p', { class: 'muted small' }, `Мова набору: ${LANG_NAMES[lang]}. Перед стартом перевір розкладку клавіатури.`),
      ]),
      h('div', { class: 'card' }, [
        h('h2', { style: { marginTop: 0 } }, 'Умова заліку'),
        ctx.graded === false
          ? h('p', {}, 'Це діагностика: результат показує твій рівень і не впливає на курс.')
          : h('p', {}, [
            `Спробу зараховано, якщо ${criterionText()}. `,
            isCourse ? `Вправу завершено після ${thresholds.streakToPass} успішних спроб поспіль (зараз ${Math.min(rec.streak, thresholds.streakToPass)} з ${thresholds.streakToPass}). ` : '',
            'Швидкість без точності не зараховується.',
          ]),
        h('p', { class: 'muted' }, 'Під час заліку екранна клавіатура й підказки приховані: дивись лише на текст. У тренуванні підказки є, але результат не зберігається.'),
        h('div', { class: 'actions' }, [
          start,
          h('button', { type: 'button', id: 'start-practice', onclick: () => renderTyping(false) }, 'Тренування з підказкою'),
        ]),
      ]),
      h('div', { class: 'card' }, [
        h('h2', { style: { marginTop: 0 } }, 'Схема пальців'),
        focus.length
          ? h('ul', {}, focus.map((ch) => h('li', {}, [h('span', { class: 'keycap' }, ch === ' ' ? '␣' : ch), ` — ${describeKey(ch, lang)}`])))
          : h('p', {}, 'Кожну клавішу натискає закріплений за нею палець; після натискання він повертається на домашній ряд.'),
        renderKeyboard({ lang, focus, opened }),
        fingerLegend(),
      ]),
    );
    start.focus();
  }

  // ---------- Набір ----------

  function renderTyping(graded) {
    const text = pickText();
    const session = new TypingSession(text, { lang, stopOnError: settings.stopOnError });
    const spans = session.chars.map((ch) => h('span', { class: 'ch' }, ch));
    const status = h('p', { class: 'type-status', role: 'status', 'aria-live': 'polite' }, 'Набір почнеться з першої клавіші.');
    const typedCount = h('span', {}, '0');
    const errorCount = h('span', {}, '0');
    const capture = h('textarea', {
      class: 'capture', id: 'typing-input', rows: '1', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      'aria-label': `Поле набору. Набирай текст вправи: ${text}`,
    });
    const panel = h('div', { class: 'type-panel' }, [
      h('p', { class: 'type-text', lang, id: 'exercise-text', dataset: { text } }, spans),
      capture,
      h('p', { class: 'resume-hint' }, 'Набір призупинено. Клацни по тексту або перейди сюди клавішею Tab, щоб продовжити.'),
    ]);
    const hintLine = h('p', { class: 'muted' });
    const keyboardSlot = h('div', {});
    let errorFlag = false;

    function setStatus(message, kind = '') {
      status.className = `type-status ${kind}`.trim();
      status.textContent = message;
    }

    function paint() {
      session.chars.forEach((_, i) => {
        let cls = 'ch';
        const state = session.states[i];
        if (state === CHAR_STATE.correct) cls += ' correct';
        else if (state === CHAR_STATE.fixed) cls += ' fixed';
        else if (state === CHAR_STATE.wrong) cls += ' wrong';
        if (i === session.pos) cls += errorFlag ? ' current error' : ' current';
        if (spans[i].className !== cls) spans[i].className = cls;
      });
      typedCount.textContent = String(session.pos);
      errorCount.textContent = String(session.errors);
      if (!graded) {
        const next = session.expected;
        if (next !== null) {
          hintLine.textContent = `Наступна клавіша: ${show(next)} — ${describeKey(next, lang)}.`;
          keyboardSlot.replaceChildren(renderKeyboard({ lang, next, opened: exercise.opened ? new Set(exercise.opened) : null }));
        }
      }
    }

    function reject() {
      setStatus('Вставку тексту відхилено: вправу треба набрати клавіша за клавішею.', 'warn');
    }

    function onChar(ch) {
      const result = session.input(ch, performance.now());
      if (result.type === 'ignored') return;
      if (result.type === 'layout') {
        setStatus(`Схоже, увімкнено іншу розкладку: натиснуто ${show(result.typed)}, а вправа — ${LANG_INSTRUMENTAL[lang]}. Перемкни розкладку; спробу ще не розпочато.`, 'warn');
        return;
      }
      if (result.type === 'error') {
        errorFlag = settings.stopOnError;
        const layoutNote = result.layout ? ' Перевір розкладку клавіатури.' : '';
        setStatus(`✗ Помилка: потрібно ${show(result.expected)}, натиснуто ${show(result.typed)}.${layoutNote}`, 'error');
        if (settings.sound) beep();
        if (app.motionAllowed()) {
          panel.classList.remove('shake');
          void panel.offsetWidth;
          panel.classList.add('shake');
        }
      } else {
        errorFlag = false;
        if (status.classList.contains('error') || status.classList.contains('warn') || session.pos === 1) setStatus('');
      }
      paint();
      if (session.finished) finish(session, graded);
    }

    function onBackspace() {
      const result = session.backspace(performance.now());
      if (result.type === 'backspace') {
        errorFlag = false;
        paint();
      }
    }

    let composing = false;
    let seenLength = 0;
    const handlers = {
      keydown(event) {
        if (event.isComposing || event.key === 'Process' || event.key === 'Dead' || event.key === 'Unidentified') return;
        if (event.key === 'Escape') { event.preventDefault(); renderIntro(); return; }
        if (event.key === 'Tab') return;
        // Ctrl без Alt і Cmd — це команди браузера, а не набір. Ctrl+Alt (AltGr) і Alt лишаються: ними набирається «ґ».
        if (event.metaKey || (event.ctrlKey && !event.altKey)) return;
        if (event.key === 'Backspace') { event.preventDefault(); onBackspace(); return; }
        if (event.key === 'Enter') { event.preventDefault(); return; }
        if ([...event.key].length === 1) {
          event.preventDefault();
          if (event.repeat) return; // утримувана клавіша не набирає серію символів
          onChar(event.key);
        }
      },
      beforeinput(event) {
        // Сюди потрапляє введення без оброблюваного keydown: екранна клавіатура телефона,
        // програмне insertText, вставка з буфера, перетягування.
        if (event.isComposing || event.inputType === 'insertCompositionText') return;
        event.preventDefault();
        if (event.inputType === 'insertText') {
          const chars = [...(event.data ?? '')];
          if (chars.length === 1) onChar(chars[0]);
          else if (chars.length > 1) reject();
        } else if (event.inputType === 'deleteContentBackward') {
          onBackspace();
        } else if (event.inputType.startsWith('insertFrom')) {
          reject();
        }
      },
      compositionstart() { composing = true; seenLength = capture.value.length; },
      compositionend() { composing = false; capture.value = ''; seenLength = 0; },
      input() {
        if (!composing) { capture.value = ''; seenLength = 0; return; }
        const delta = capture.value.length - seenLength;
        seenLength = capture.value.length;
        if (delta === 1) onChar(capture.value.at(-1));
        else if (delta === -1) onBackspace();
        else if (delta > 1) reject();
      },
      paste(event) { event.preventDefault(); reject(); },
      drop(event) { event.preventDefault(); reject(); },
    };
    for (const [name, handler] of Object.entries(handlers)) capture.addEventListener(name, handler);

    mount(root,
      h('div', { class: 'trainer-head' }, [
        h('h1', {}, exercise.title),
        stageBadge(),
        graded
          ? h('span', { class: 'badge ok', id: 'mode-badge' }, ctx.graded === false ? 'Діагностика — без підказок' : 'Залік — без підказок')
          : h('span', { class: 'badge warn', id: 'mode-badge' }, 'Тренування — результат не зберігається'),
      ]),
      status,
      panel,
      h('p', { class: 'type-meta' }, [
        h('span', {}, ['Набрано: ', typedCount, ` з ${session.chars.length}`]),
        h('span', {}, ['Помилок: ', errorCount]),
        h('span', {}, settings.stopOnError ? 'Режим: зупинка на помилці' : 'Режим: виправлення клавішею Backspace'),
        graded && ctx.graded !== false && h('span', {}, `Залік: ${criterionText()}`),
      ]),
      !graded && hintLine,
      !graded && keyboardSlot,
      h('div', { class: 'actions' }, [
        h('button', { type: 'button', onclick: () => renderTyping(graded) }, 'Почати спочатку'),
        h('button', { type: 'button', onclick: renderIntro }, 'Вийти з вправи (Esc)'),
      ]),
    );
    paint();
    capture.focus();
  }

  // ---------- Результат ----------

  function finish(session, graded) {
    const metrics = session.metrics();
    const verdict = judgeAttempt(metrics, thresholds);
    const analysis = analyzeAttempt(session);
    const before = record();
    const counted = graded;
    let after = before;

    if (counted) {
      if (isCourse) after = recordAttempt(profile.progress[lang], exercise, metrics, verdict, settings);
      if (metrics.plausibility.ok) updateStats(profile.stats[lang], session);
      addHistory(profile, {
        t: new Date().toISOString(), lang, id: exercise.id, title: exercise.title, stage: exercise.stage,
        spm: Math.round(metrics.spm * 10) / 10, accuracy: Math.round(metrics.accuracy * 100) / 100,
        errors: metrics.errors, ms: Math.round(metrics.elapsedMs), passed: verdict.passed,
      });
      app.save();
    }
    renderResult({ session, graded, metrics, verdict, analysis, before, after });
  }

  function rhythmChart(session) {
    const points = session.timeline.slice(1);
    if (points.length < 4) return null;
    const width = 720;
    const height = 150;
    const max = Math.min(1500, Math.max(...points.map((p) => p.ms), 200));
    const step = (width - 40) / points.length;
    const bars = points.map((point, i) => {
      const value = Math.min(point.ms, max);
      const barHeight = Math.max(2, (value / max) * (height - 36));
      const x = 34 + i * step;
      return [
        svg('rect', { class: point.ok ? 'bar' : 'bar err', x: x.toFixed(1), y: (height - 20 - barHeight).toFixed(1), width: Math.max(1.5, step - 1.5).toFixed(1), height: barHeight.toFixed(1) }),
        !point.ok && svg('text', { x: (x + step / 2).toFixed(1), y: (height - 24 - barHeight).toFixed(1), 'text-anchor': 'middle' }, '✗'),
      ];
    });
    return h('figure', { style: { margin: '0 0 14px' } }, [
      svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Ритм набору: висота стовпчика — пауза перед натисканням. Стовпчики з позначкою ✗ — позиції з помилкою.' }, [
        svg('line', { class: 'axis', x1: 34, y1: height - 20, x2: width - 6, y2: height - 20 }),
        svg('text', { x: 4, y: 14 }, `${Math.round(max)} мс`),
        svg('text', { x: 4, y: height - 22 }, '0'),
        svg('text', { x: 34, y: height - 5 }, 'перша клавіша'),
        svg('text', { x: width - 6, y: height - 5, 'text-anchor': 'end' }, 'остання клавіша'),
        bars,
      ]),
      h('figcaption', { class: 'muted small' }, 'Ритм: пауза перед кожним натисканням. Рівні стовпчики — рівний ритм; ✗ — позиція з помилкою.'),
    ]);
  }

  function renderResult({ session, graded, metrics, verdict, analysis, before, after }) {
    const counted = graded && ctx.graded !== false;
    const streak = isCourse ? after.streak : verdict.passed ? 1 : 0;
    const nextInCourse = isCourse ? app.nextAfter(exercise.id) : null;
    const advice = recommend({
      session, metrics, verdict, analysis, thresholds, streak,
      streakToPass: isCourse ? thresholds.streakToPass : 1,
      hasNext: Boolean(nextInCourse) || Boolean(ctx.onContinue),
    });

    let verdictBox;
    if (!graded) {
      verdictBox = h('div', { class: 'notice warn', id: 'verdict' }, h('p', {}, h('strong', {}, 'Тренування. '), 'Результат не збережено: він не впливає на прогрес і статистику. Коли відчуєш готовність — пройди залік без підказок.'));
    } else if (ctx.graded === false) {
      verdictBox = h('div', { class: 'notice', id: 'verdict' }, h('p', {}, h('strong', {}, 'Діагностику завершено. '), 'Нижче — твої показники та порада, з чого почати.'));
    } else if (verdict.passed) {
      verdictBox = h('div', { class: 'notice ok', id: 'verdict', dataset: { passed: 'true' } }, [
        h('p', {}, [h('strong', {}, '✓ Спробу зараховано. '), isCourse ? `Успішних спроб поспіль: ${Math.min(after.streak, thresholds.streakToPass)} з ${thresholds.streakToPass}.` : '']),
        isCourse && after.passed && h('p', {}, h('strong', {}, after.justPassed ? 'Вправу завершено — наступну відкрито.' : 'Вправу вже завершено.')),
      ]);
    } else {
      const reasons = {
        accuracy: `точність ${fmt.pct(metrics.accuracy)} нижча за поріг ${thresholds.minAccuracy} %. Швидкість без точності не зараховується.`,
        tempo: `точність достатня, але швидкість ${fmt.int(metrics.spm)} зн/хв нижча за цільову ${thresholds.targetSpm} зн/хв.`,
        implausible: 'текст з\'явився швидше, ніж можна набрати руками (вставка або автоматичне введення).',
      };
      verdictBox = h('div', { class: 'notice bad', id: 'verdict', dataset: { passed: 'false' } }, [
        h('p', {}, [h('strong', {}, '✗ Спробу не зараховано: '), reasons[verdict.reason]]),
        isCourse && h('p', {}, `Серію успішних спроб обнулено: 0 з ${thresholds.streakToPass}.`),
      ]);
    }

    const compare = [];
    if (counted && isCourse && before.attempts > 0) {
      const delta = metrics.spm - before.lastSpm;
      compare.push(`Попередня спроба: ${fmt.int(before.lastSpm)} зн/хв, ${fmt.pct(before.lastAccuracy)} (${delta >= 0 ? '+' : '−'}${fmt.int(Math.abs(delta))} зн/хв).`);
      if (before.bestSpm > 0) {
        compare.push(verdict.passed && metrics.spm > before.bestSpm ? `Новий особистий рекорд вправи (був ${fmt.int(before.bestSpm)} зн/хв).` : `Особистий рекорд вправи: ${fmt.int(before.bestSpm)} зн/хв.`);
      }
    } else if (counted && isCourse) {
      compare.push('Це перша залікова спроба цієї вправи — порівнювати ще ні з чим.');
    }

    const tile = (label, value, sub, id) => h('div', { class: 'tile' }, [h('div', { class: 'label' }, label), h('div', { class: 'value', id }, value), h('div', { class: 'sub' }, sub)]);

    const actions = [];
    const retry = () => renderTyping(graded);
    const primary = (label, run) => h('button', { class: 'primary', type: 'button', id: 'next-action', onclick: run }, label);
    if (ctx.onContinue && (ctx.continueAlways || verdict.passed || !graded || ctx.graded === false)) {
      actions.push(primary(ctx.onContinue.label, ctx.onContinue.run));
    } else if (advice.action.type === 'drill') {
      actions.push(primary('Вправа на слабке місце', () => app.startDrill(advice.action, { backHref: `#/ex/${exercise.id}`, backLabel: `Назад до «${exercise.title}»` })));
    } else if (advice.action.type === 'next' && nextInCourse) {
      actions.push(primary(`Наступна вправа: ${nextInCourse.title}`, () => app.go(`#/ex/${nextInCourse.id}`)));
    } else if (advice.action.type === 'weak') {
      actions.push(primary('Слабкі місця', () => app.go('#/weak')));
    } else {
      actions.push(primary(graded ? 'Повторити залік' : 'Повторити тренування', retry));
    }
    if (!actions[0].textContent.startsWith('Повторити')) actions.push(h('button', { type: 'button', onclick: retry }, graded ? 'Повторити залік' : 'Повторити тренування'));
    if (!graded) actions.push(h('button', { type: 'button', onclick: () => renderTyping(true) }, 'Пройти залік'));
    if (isCourse && nextInCourse && after.passed && advice.action.type !== 'next') {
      actions.push(h('a', { class: 'button', href: `#/ex/${nextInCourse.id}` }, `Наступна вправа: ${nextInCourse.title}`));
    }
    actions.push(h('a', { class: 'button', href: ctx.backHref ?? '#/' }, ctx.backLabel ?? 'На головну'));

    const errorsTable = analysis.errorsByChar.length
      ? h('div', { class: 'table-scroll' }, h('table', { id: 'errors-table' }, [
        h('caption', {}, 'Помилки за символами'),
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Символ'), h('th', { scope: 'col' }, 'Клавіша й палець'), h('th', { scope: 'col' }, 'Що натискалося'), h('th', { scope: 'col', class: 'num' }, 'Помилок')])),
        h('tbody', {}, analysis.errorsByChar.map((entry) => h('tr', {}, [
          h('td', {}, h('span', { class: 'keycap' }, entry.ch === ' ' ? '␣' : entry.ch)),
          h('td', {}, entry.key || '—'),
          h('td', { class: 'mono' }, analysis.confusions.filter((c) => c.expected === entry.ch).map((c) => `${displayChar(c.typed)} ×${c.count}`).join(', ')),
          h('td', { class: 'num' }, String(entry.count)),
        ]))),
      ]))
      : h('p', {}, 'Жодної помилки — чиста спроба.');

    const slowTable = analysis.slowTransitions.length
      ? h('div', { class: 'table-scroll' }, h('table', {}, [
        h('caption', {}, 'Найповільніші переходи між клавішами'),
        h('thead', {}, h('tr', {}, [h('th', { scope: 'col' }, 'Перехід'), h('th', { scope: 'col' }, 'Характер руху'), h('th', { scope: 'col', class: 'num' }, 'Середня пауза'), h('th', { scope: 'col', class: 'num' }, 'Відносно типової')])),
        h('tbody', {}, analysis.slowTransitions.map((entry) => h('tr', {}, [
          h('td', {}, keycaps(entry.pair)),
          h('td', {}, entry.kind),
          h('td', { class: 'num' }, `${fmt.int(entry.ms)} мс`),
          h('td', { class: 'num' }, `×${fmt.one(entry.ratio)}`),
        ]))),
      ]))
      : null;

    mount(root,
      h('div', { class: 'trainer-head' }, [h('h1', { tabindex: '-1', id: 'result-title' }, `Результат: ${exercise.title}`), stageBadge()]),
      verdictBox,
      h('div', { class: 'tiles', id: 'metrics', dataset: { spm: metrics.spm.toFixed(2), accuracy: metrics.accuracy.toFixed(2), errors: String(metrics.errors), ms: String(Math.round(metrics.elapsedMs)), chars: String(metrics.chars) } }, [
        tile('Швидкість', `${fmt.int(metrics.spm)} зн/хв`, `SPM = 60 · ${metrics.chars} / ${fmt.one(metrics.elapsedMs / 1000)} с; WPM = SPM / 5 = ${fmt.int(metrics.wpm)}`, 'metric-spm'),
        tile('Точність', fmt.pct(metrics.accuracy), `(${metrics.chars} − ${metrics.errors}) / ${metrics.chars}; виправлені помилки враховано`, 'metric-accuracy'),
        tile('Помилок', String(metrics.errors), session.stopOnError ? 'усі помилкові натискання' : `з них невиправлених: ${session.uncorrected}`, 'metric-errors'),
        tile('Час', formatDuration(metrics.elapsedMs), 'від першої до останньої клавіші', 'metric-time'),
        tile('Нерівномірність ритму', `${fmt.int(metrics.unevenness)} %`, metrics.unevenness <= 30 ? 'рівний ритм' : metrics.unevenness <= 50 ? 'помірно нерівний' : 'рваний ритм', 'metric-rhythm'),
      ]),
      exercise.tempoBand && h('p', {}, `Орієнтир темпу цієї вправи: ${exercise.tempoBand[0]}–${exercise.tempoBand[1]} зн/хв. Твій темп: ${fmt.int(metrics.spm)} зн/хв — ${metrics.spm < exercise.tempoBand[0] ? 'повільніше за орієнтир' : metrics.spm > exercise.tempoBand[1] ? 'швидше за орієнтир' : 'у межах орієнтира'}.`),
      compare.length ? h('p', { id: 'compare' }, compare.join(' ')) : null,
      h('div', { class: 'card', id: 'advice' }, [
        h('h2', { style: { marginTop: 0 } }, 'Наступна дія'),
        h('p', {}, advice.text),
        h('div', { class: 'actions' }, actions),
      ]),
      ctx.afterResult ? ctx.afterResult({ metrics, verdict, analysis }) : null,
      h('h2', {}, 'Розбір спроби'),
      errorsTable,
      slowTable,
      rhythmChart(session),
    );
    actions[0].focus();
    window.scrollTo(0, 0);
  }

  renderIntro();
  if (ctx.autostart) renderTyping(true);
  return root;
}
