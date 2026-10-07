// Застосунок «Гами»: стан, маршрути, оболонка. Без збирання й залежностей — звичайні ES-модулі.

import { buildWeakDrill, fallbackChars } from './core/adaptive.js';
import { weakSpots } from './core/analysis.js';
import { flattenCourse, isPassed, isUnlocked, nextExercise, openedChars } from './core/progress.js';
import { loadProfile, saveProfile } from './core/storage.js';
import { h, mount } from './ui/dom.js';
import { trainerView } from './ui/trainer.js';
import * as views from './ui/views.js';

const NAV = [
  ['#/', 'Головна'],
  ['#/stage/1', 'Етап 1 · Гами'],
  ['#/stage/2', 'Етап 2 · Слова'],
  ['#/academy', 'Етап 3 · Академія'],
  ['#/session', 'Заняття'],
  ['#/stats', 'Статистика'],
  ['#/settings', 'Налаштування'],
];

class App {
  constructor() {
    this.storage = window.localStorage;
    this.profile = loadProfile(this.storage);
    this.saveFailed = false;
    this.cache = { curriculum: {}, words: {} };
    this.pendingDrill = null;
    this.session = null;
    this.main = document.getElementById('main');
    this.nav = document.getElementById('nav');
    this.renderToken = 0;
  }

  get lang() {
    return this.profile.lang;
  }

  get settings() {
    return this.profile.settings;
  }

  save() {
    if (!this.profile.createdAt) this.profile.createdAt = new Date().toISOString();
    this.saveFailed = !saveProfile(this.storage, this.profile);
  }

  go(hash) {
    if (window.location.hash === hash) this.render();
    else window.location.hash = hash;
  }

  motionAllowed() {
    if (this.settings.motion === 'off') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  applySettings() {
    const rootEl = document.documentElement;
    rootEl.style.setProperty('--exercise-size', `${this.settings.fontSize}px`);
    if (this.settings.theme === 'auto') delete rootEl.dataset.theme;
    else rootEl.dataset.theme = this.settings.theme;
    if (this.settings.motion === 'off') rootEl.dataset.motion = 'off';
    else delete rootEl.dataset.motion;
  }

  async fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Не вдалося завантажити ${path} (${response.status})`);
    return response.json();
  }

  /** Навчальна програма мови: дані та плаский список вправ у порядку проходження. */
  async curriculum(lang = this.lang) {
    if (!this.cache.curriculum[lang]) {
      const data = await this.fetchJson(`data/curriculum/${lang}.json`);
      this.cache.curriculum[lang] = { data, course: flattenCourse(data) };
    }
    return this.cache.curriculum[lang];
  }

  async words(lang = this.lang) {
    if (!this.cache.words[lang]) this.cache.words[lang] = (await this.fetchJson(`data/derived/${lang}/words.json`)).words;
    return this.cache.words[lang];
  }

  progress(lang = this.lang) {
    return this.profile.progress[lang];
  }

  unlocked(course, id) {
    return isUnlocked(course, this.progress(), id, this.settings.freeAccess);
  }

  /** Наступна вправа курсу після щойно зарахованої (null, якщо поточну ще не завершено). */
  nextAfter(id) {
    const entry = this.cache.curriculum[this.lang];
    if (!entry || !isPassed(this.progress(), id)) return null;
    const { course } = entry;
    const index = course.findIndex((exercise) => exercise.id === id);
    const following = course.slice(index + 1).find((exercise) => !isPassed(this.progress(), exercise.id));
    if (following && this.unlocked(course, following.id)) return following;
    const next = nextExercise(course, this.progress());
    return next && next.id !== id ? next : null;
  }

  /** Вправа на слабкі місця: задані клавіші/переходи або найслабші за статистикою. */
  async weakDrill({ chars = null, pairs = null } = {}) {
    const { data, course } = await this.curriculum();
    let opened = openedChars(data, course, this.progress(), this.settings.freeAccess);
    if (opened.trim() === '') {
      // Ще жодної гами не зараховано: беремо клавіші уроку, який учень проходить зараз.
      const current = nextExercise(course, this.progress());
      opened = current?.opened ?? opened;
    }
    const spots = weakSpots(this.profile.stats[this.lang], this.lang);
    let focusChars = chars ?? spots.keys.slice(0, 3).map((entry) => entry.ch);
    const focusPairs = pairs ?? spots.transitions.slice(0, 2).map((entry) => entry.pair);
    let fromStats = true;
    if (!focusChars.length && !focusPairs.length) {
      focusChars = fallbackChars(opened, this.lang);
      fromStats = false;
    }
    const words = await this.words();
    const drill = buildWeakDrill({
      lang: this.lang, chars: focusChars, pairs: focusPairs, opened, words,
      seed: `weak-${this.profile.history.length}`,
    });
    if (drill && !fromStats) {
      drill.goal = `Статистики помилок ще немає, тому вправу зібрано з останніх відкритих клавіш. ${drill.goal.replace('Вправу зібрано за твоїми результатами: ', 'Фокус: ')}`;
    }
    if (drill) drill.opened = opened;
    return drill;
  }

  async startDrill(action, ctx = {}) {
    this.pendingDrill = { drill: await this.weakDrill({ chars: action.chars, pairs: action.pairs }), ctx };
    this.go('#/drill');
  }

  setLang(lang) {
    if (lang === this.lang) return;
    this.profile.lang = lang;
    this.session = null;
    this.pendingDrill = null;
    this.save();
    // Вправа належить мові: після перемикання повертаємося на головну.
    if (/^#\/(ex|drill|session\/run|diagnostic)/.test(window.location.hash)) this.go('#/');
    else this.render();
  }

  renderNav(route) {
    const current = (href) => {
      if (href === '#/') return route === '/' || route === '/start';
      return route.startsWith(href.slice(1));
    };
    const langButton = (lang, label, name) => h('button', {
      type: 'button', 'aria-pressed': String(this.lang === lang), 'aria-label': `${label} — мова набору ${name}`, dataset: { lang },
      onclick: () => this.setLang(lang),
    }, label);
    mount(this.nav,
      NAV.map(([href, label]) => h('a', { href, 'aria-current': current(href) ? 'page' : null }, label)),
      h('span', { class: 'spacer' }),
      h('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Мова набору' }, [
        langButton('uk', 'УКР', 'українська'),
        langButton('en', 'ENG', 'англійська'),
      ]),
    );
  }

  async resolve(route) {
    const parts = route.split('/').filter(Boolean);
    const [section, arg] = parts;
    if (!this.profile.onboarded[this.lang] && !['sources', 'help', 'settings', 'diagnostic'].includes(section)) {
      return views.onboarding(this);
    }
    switch (section) {
      case undefined: return views.home(this);
      case 'start': return views.onboarding(this);
      case 'stage': return views.stage(this, arg === '2' ? 2 : 1);
      case 'academy': return views.academy(this);
      case 'ex': return views.exercise(this, arg);
      case 'weak': return views.weak(this);
      case 'drill': return views.drill(this);
      case 'diagnostic': return views.diagnostic(this);
      case 'session': return arg === 'run' ? views.sessionRun(this) : views.session(this);
      case 'stats': return views.stats(this);
      case 'settings': return views.settings(this);
      case 'sources': return views.sources(this);
      case 'help': return views.help(this);
      default: return views.notFound(this);
    }
  }

  async render() {
    const token = ++this.renderToken;
    const route = window.location.hash.replace(/^#/, '') || '/';
    this.applySettings();
    this.renderNav(route);
    let node;
    try {
      node = await this.resolve(route);
    } catch (error) {
      console.error(error);
      node = h('div', { class: 'notice bad' }, [
        h('h1', {}, 'Не вдалося відкрити сторінку'),
        h('p', {}, String(error.message ?? error)),
        h('p', {}, h('a', { href: '#/' }, 'На головну')),
      ]);
    }
    if (token !== this.renderToken) return; // за цей час відкрито інший маршрут
    mount(this.main,
      this.saveFailed && h('div', { class: 'notice bad', role: 'alert' }, h('p', {}, 'Браузер не дозволив зберегти прогрес (сховище вимкнене або переповнене). Результати цього сеансу можуть не зберегтися.')),
      node,
    );
    const title = this.main.querySelector('h1')?.textContent;
    document.title = title ? `${title} — Гами` : 'Гами — тренажер сенсорного набору';
    const autofocus = this.main.querySelector('[data-autofocus]');
    if (autofocus) autofocus.focus();
    else if (this.booted) this.main.focus({ preventScroll: true });
    this.booted = true;
    window.scrollTo(0, 0);
  }
}

const app = new App();
app.trainerView = trainerView;
window.addEventListener('hashchange', () => app.render());
app.render();

if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим — бонус, не обов'язкова частина */ });
}
