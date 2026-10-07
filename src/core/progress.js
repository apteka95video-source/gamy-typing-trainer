// Навчальний шлях: порядок вправ, відкриття, залік і поступ модулів.

/** Усі вправи курсу в порядку проходження: уроки (етапи 1–2), далі Академія (етап 3). */
export function flattenCourse(curriculum) {
  const list = [];
  for (const lesson of curriculum.lessons) {
    for (const exercise of lesson.exercises) {
      list.push({ ...exercise, group: lesson.id, groupTitle: `Урок ${lesson.n}. ${lesson.title}`, opened: lesson.opened });
    }
  }
  const allOpened = curriculum.lessons.at(-1).opened;
  for (const module of curriculum.academy) {
    for (const exercise of module.exercises) {
      list.push({ ...exercise, group: module.id, groupTitle: `Академія, модуль ${module.n}. ${module.title}`, opened: allOpened });
    }
  }
  return list;
}

export function emptyProgress() {
  return { exercises: {} };
}

export function exerciseRecord(progress, id) {
  return progress.exercises[id] ?? { attempts: 0, streak: 0, passed: false, bestSpm: 0, bestAccuracy: 0, lastSpm: 0, lastAccuracy: 0, variant: 0 };
}

export function isPassed(progress, id) {
  return progress.exercises[id]?.passed === true;
}

/** Перша незарахована вправа шляху (або null, якщо курс пройдено). */
export function nextExercise(course, progress) {
  return course.find((exercise) => !isPassed(progress, exercise.id)) ?? null;
}

/**
 * Вправа відкрита, якщо зараховано всі попередні (або ввімкнено вільний доступ).
 * Уже зараховану вправу можна повторити завжди.
 */
export function isUnlocked(course, progress, id, freeAccess = false) {
  if (freeAccess || isPassed(progress, id)) return true;
  const next = nextExercise(course, progress);
  return next !== null && next.id === id;
}

/** Пороги заліку для вправи з урахуванням налаштувань. */
export function thresholdsFor(exercise, settings) {
  return {
    minAccuracy: settings.minAccuracy[exercise.stage] ?? settings.minAccuracy[3],
    targetSpm: exercise.tempo ? settings.tempoTargetSpm : null,
    streakToPass: settings.streakToPass,
  };
}

/**
 * Записує залікову спробу. Серія успішних спроб обнуляється першою ж невдалою.
 * @returns оновлений запис вправи з прапорцем justPassed
 */
export function recordAttempt(progress, exercise, metrics, verdict, settings) {
  const previous = exerciseRecord(progress, exercise.id);
  const record = { ...previous };
  record.attempts += 1;
  record.variant = (previous.variant + 1) % Math.max(1, exercise.texts.length);
  record.lastSpm = metrics.spm;
  record.lastAccuracy = metrics.accuracy;
  record.streak = verdict.passed ? previous.streak + 1 : 0;
  if (verdict.passed) {
    record.bestSpm = Math.max(previous.bestSpm, metrics.spm);
    record.bestAccuracy = Math.max(previous.bestAccuracy, metrics.accuracy);
  }
  const justPassed = !previous.passed && record.streak >= settings.streakToPass;
  if (justPassed) record.passed = true;
  progress.exercises[exercise.id] = record;
  return { ...record, justPassed };
}

export function groupProgress(exercises, progress) {
  const total = exercises.length;
  const passed = exercises.filter((exercise) => isPassed(progress, exercise.id)).length;
  return { total, passed, done: total > 0 && passed === total };
}

/** Символи, які учень уже відкрив: клавіші всіх уроків до поточного включно. */
export function openedChars(curriculum, course, progress, freeAccess = false) {
  const last = curriculum.lessons.at(-1).opened;
  if (freeAccess) return last;
  const next = nextExercise(course, progress);
  if (!next) return last;
  if (next.stage === 3) return last;
  const lesson = curriculum.lessons.find((l) => l.id === next.group);
  // Поки етап 1 уроку не пройдено, нові клавіші ще не вважаються відкритими для слів.
  const stage1Done = lesson.exercises.filter((e) => e.stage === 1).every((e) => isPassed(progress, e.id));
  if (stage1Done) return lesson.opened;
  const index = curriculum.lessons.indexOf(lesson);
  return index > 0 ? curriculum.lessons[index - 1].opened : ' ';
}

/** Поточний рівень учня в курсі — для заголовків і плану заняття. */
export function coursePosition(curriculum, course, progress) {
  const next = nextExercise(course, progress);
  const passed = course.filter((exercise) => isPassed(progress, exercise.id)).length;
  return { next, passed, total: course.length, percent: Math.round((passed / course.length) * 100) };
}
