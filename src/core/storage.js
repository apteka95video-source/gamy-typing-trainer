// Профіль користувача: лише локальне сховище браузера, без сервера й мережі.

import { DEFAULT_SETTINGS, HISTORY_LIMIT, PROFILE_VERSION, STORAGE_KEY, clampSetting } from './config.js';
import { emptyStats } from './analysis.js';
import { emptyProgress } from './progress.js';

export const LANGS = ['uk', 'en'];

export function createProfile() {
  return {
    version: PROFILE_VERSION,
    createdAt: null,
    lang: 'uk',
    onboarded: { uk: false, en: false },
    settings: structuredClone(DEFAULT_SETTINGS),
    progress: { uk: emptyProgress(), en: emptyProgress() },
    stats: { uk: emptyStats(), en: emptyStats() },
    history: [],
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Приводить довільні дані до коректного профілю; чужі чи зіпсовані поля відкидаються. */
export function sanitizeProfile(raw) {
  const profile = createProfile();
  if (!isObject(raw) || raw.version !== PROFILE_VERSION) return profile;

  if (LANGS.includes(raw.lang)) profile.lang = raw.lang;
  if (typeof raw.createdAt === 'string') profile.createdAt = raw.createdAt;
  if (isObject(raw.onboarded)) for (const lang of LANGS) profile.onboarded[lang] = raw.onboarded[lang] === true;

  if (isObject(raw.settings)) {
    const s = raw.settings;
    if (isObject(s.minAccuracy)) {
      for (const stage of [1, 2, 3]) {
        if (s.minAccuracy[stage] !== undefined) profile.settings.minAccuracy[stage] = clampSetting('minAccuracy', s.minAccuracy[stage]);
      }
    }
    for (const name of ['streakToPass', 'tempoTargetSpm', 'fontSize']) {
      if (s[name] !== undefined) profile.settings[name] = clampSetting(name, s[name]);
    }
    for (const name of ['stopOnError', 'sound', 'freeAccess']) {
      if (typeof s[name] === 'boolean') profile.settings[name] = s[name];
    }
    if (['auto', 'off'].includes(s.motion)) profile.settings.motion = s.motion;
    if (['auto', 'light', 'dark'].includes(s.theme)) profile.settings.theme = s.theme;
  }

  const number = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
  for (const lang of LANGS) {
    const exercises = raw.progress?.[lang]?.exercises;
    if (isObject(exercises)) {
      for (const [id, record] of Object.entries(exercises)) {
        if (!isObject(record) || id.length > 40) continue;
        profile.progress[lang].exercises[id] = {
          attempts: number(record.attempts),
          streak: number(record.streak),
          passed: record.passed === true,
          bestSpm: number(record.bestSpm),
          bestAccuracy: number(record.bestAccuracy),
          lastSpm: number(record.lastSpm),
          lastAccuracy: number(record.lastAccuracy),
          variant: number(record.variant),
        };
      }
    }
    const stats = raw.stats?.[lang];
    if (isObject(stats?.keys)) {
      for (const [ch, e] of Object.entries(stats.keys)) {
        if ([...ch].length === 1 && isObject(e)) profile.stats[lang].keys[ch] = { n: number(e.n), err: number(e.err), ms: number(e.ms), timed: number(e.timed) };
      }
    }
    if (isObject(stats?.pairs)) {
      for (const [pair, e] of Object.entries(stats.pairs)) {
        if ([...pair].length === 2 && isObject(e)) profile.stats[lang].pairs[pair] = { n: number(e.n), ms: number(e.ms) };
      }
    }
  }

  if (Array.isArray(raw.history)) {
    profile.history = raw.history
      .filter((item) => isObject(item) && LANGS.includes(item.lang) && typeof item.id === 'string')
      .slice(-HISTORY_LIMIT)
      .map((item) => ({
        t: typeof item.t === 'string' ? item.t : '',
        lang: item.lang,
        id: item.id.slice(0, 40),
        title: String(item.title ?? '').slice(0, 120),
        stage: [1, 2, 3].includes(item.stage) ? item.stage : 0,
        spm: number(item.spm),
        accuracy: number(item.accuracy),
        errors: number(item.errors),
        ms: number(item.ms),
        passed: item.passed === true,
      }));
  }
  return profile;
}

export function loadProfile(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createProfile();
    return sanitizeProfile(JSON.parse(raw));
  } catch {
    return createProfile();
  }
}

/** @returns {boolean} чи вдалося зберегти (сховище може бути вимкнене або переповнене) */
export function saveProfile(storage, profile) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function addHistory(profile, entry) {
  profile.history.push(entry);
  if (profile.history.length > HISTORY_LIMIT) profile.history.splice(0, profile.history.length - HISTORY_LIMIT);
}

export function exportProfile(profile) {
  return JSON.stringify({ app: 'gamy', exportedAt: new Date().toISOString(), profile }, null, 2);
}

/** @throws {Error} якщо файл не є експортом профілю «Гами» */
export function importProfile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не є коректним JSON.');
  }
  if (!isObject(data) || data.app !== 'gamy' || !isObject(data.profile)) {
    throw new Error('Це не файл профілю «Гами».');
  }
  if (data.profile.version !== PROFILE_VERSION) {
    throw new Error('Файл створено іншою версією програми.');
  }
  return sanitizeProfile(data.profile);
}
