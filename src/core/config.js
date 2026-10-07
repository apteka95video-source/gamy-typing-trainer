// Налаштування за замовчуванням. Усі пороги конфігуровані (ТЗ, розділ 4.3):
// користувач змінює їх на сторінці «Налаштування», значення зберігаються в профілі.

export const APP_NAME = 'Гами';
export const STORAGE_KEY = 'gamy.profile.v1';
export const PROFILE_VERSION = 1;
export const HISTORY_LIMIT = 400;

export const DEFAULT_SETTINGS = {
  // Мінімальна точність для заліку за етапами, %.
  minAccuracy: { 1: 95, 2: 96, 3: 97 },
  // Скільки успішних спроб поспіль зараховують вправу.
  streakToPass: 3,
  // Цільова швидкість для модуля «Темпові серії», знаків за хвилину.
  tempoTargetSpm: 150,
  // true — зупинка на помилці; false — помилка вставляється й виправляється Backspace.
  stopOnError: true,
  // Розмір тексту вправи, px.
  fontSize: 28,
  sound: false,
  // 'auto' — за системним prefers-reduced-motion; 'off' — анімації вимкнено.
  motion: 'auto',
  // 'auto' | 'light' | 'dark'
  theme: 'auto',
  // Вільний доступ до всіх вправ (для тих, хто вже набирає наосліп).
  freeAccess: false,
};

export const SETTING_LIMITS = {
  minAccuracy: { min: 90, max: 100 },
  streakToPass: { min: 1, max: 5 },
  tempoTargetSpm: { min: 60, max: 600 },
  fontSize: { min: 20, max: 44 },
};

// Орієнтири рівнів із ТЗ (розділ 4.3). Використовуються в діагностиці та довідці.
export const LEVELS = [
  { id: 'intro', name: 'Ознайомлення', spm: [0, 100], minAccuracy: 95, goal: 'правильний палець і повернення на домашній ряд' },
  { id: 'basic', name: 'Базовий', spm: [100, 150], minAccuracy: 96, goal: 'стабільна механіка' },
  { id: 'confident', name: 'Впевнений', spm: [150, 225], minAccuracy: 97, goal: 'слова й типові переходи' },
  { id: 'working', name: 'Робочий', spm: [225, 300], minAccuracy: 97, goal: "зв'язний текст і рівний ритм" },
  { id: 'fast', name: 'Швидкісний', spm: [300, Infinity], minAccuracy: 98, goal: 'темп без втрати точності' },
];

// Спроба не зараховується, якщо набір швидший, ніж можливо для людини
// (програмна вставка, миттєва серія подій).
export const PLAUSIBILITY = {
  minChars: 8,
  maxSpm: 1500,
  minMedianIntervalMs: 25,
};

export function levelForSpm(spm) {
  return LEVELS.find((level) => spm >= level.spm[0] && spm < level.spm[1]) ?? LEVELS[0];
}

export function clampSetting(name, value) {
  const limits = SETTING_LIMITS[name];
  if (!limits) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return limits.min;
  return Math.min(limits.max, Math.max(limits.min, Math.round(number)));
}
