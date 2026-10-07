// Наскрізні сценарії в справжньому браузері. Кожен тест стартує з чистого профілю (нового контексту).
import { expect, test } from '@playwright/test';

const STORAGE_KEY = 'gamy.profile.v1';

/** Набирає текст клавіша за клавішею й повертає фактичний час від першої до останньої клавіші. */
async function typeText(page, text, delay = 55) {
  const chars = [...text];
  let first = 0;
  let last = 0;
  for (let i = 0; i < chars.length; i += 1) {
    if (i > 0) await page.waitForTimeout(delay);
    await page.keyboard.type(chars[i]);
    last = Date.now();
    if (i === 0) first = last;
  }
  return last - first;
}

const exerciseText = (page) => page.locator('#exercise-text').getAttribute('data-text');
const metrics = async (page) => {
  const data = await page.locator('#metrics').evaluate((el) => ({ ...el.dataset }));
  return { spm: Number(data.spm), accuracy: Number(data.accuracy), errors: Number(data.errors), ms: Number(data.ms), chars: Number(data.chars) };
};
const profile = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

/** Перший запуск: мова й рівень обираються в інтерфейсі, як це зробив би новий користувач. */
async function onboard(page, { lang = 'uk', level = 'beginner' } = {}) {
  await page.goto('./');
  if (lang === 'en') await page.locator('main button[data-lang="en"]').click();
  await page.locator(`#start-${level}`).click();
}

async function startGraded(page, id) {
  await page.goto('about:blank'); // повне завантаження сторінки, а не лише зміна адреси в межах застосунку
  await page.goto(`./#/ex/${id}`);
  await expect(page.locator('#start-graded')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-input')).toBeFocused();
  return exerciseText(page);
}

async function setSetting(page, mutate) {
  await page.evaluate(([key, source]) => {
    const data = JSON.parse(localStorage.getItem(key));
    new Function('s', source)(data.settings);
    localStorage.setItem(key, JSON.stringify(data));
  }, [STORAGE_KEY, mutate]);
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  page.problems = [];
  page.external = [];
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) page.problems.push(message.text()); });
  page.on('pageerror', (error) => page.problems.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith('http://localhost')) page.external.push(request.url()); });
});

test.afterEach(async ({ page }) => {
  expect(page.problems, 'помилки й попередження консолі').toEqual([]);
  expect(page.external, 'запити на сторонні домени').toEqual([]);
});

test('новий профіль: вибір мови й рівня, перша вправа — клавіші домашнього ряду', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('h1')).toHaveText('Гами — тренажер сенсорного набору');
  expect(await profile(page)).toBeNull();
  await page.locator('main button[data-lang="en"]').click();
  await expect(page.locator('main button[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-beginner').click();
  await expect(page.locator('h1')).toHaveText('Курс: English · QWERTY');
  await expect(page.locator('#continue')).toHaveText('Почати: Нова клавіша «f»');
  await expect(page.locator('#continue')).toBeFocused();
});

test('етап 1, англійська: залік без клавіатури й підказок, метрики сходяться з ручним розрахунком', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  const text = await startGraded(page, 'en-l01-s1-03');
  expect(text).toMatch(/^[fj ]+$/);

  // Під час заліку на сторінці немає жодної клавіатури чи підказки наступної клавіші.
  await expect(page.locator('#mode-badge')).toHaveText('Залік — без підказок');
  await expect(page.locator('.keyboard')).toHaveCount(0);
  await expect(page.locator('.kb-key')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Наступна клавіша');

  const elapsed = await typeText(page, text, 60);
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'true');
  const m = await metrics(page);
  expect(m.chars).toBe(text.length);
  expect(m.errors).toBe(0);
  expect(m.accuracy).toBe(100);
  const expectedSpm = (60_000 * text.length) / elapsed;
  expect(Math.abs(m.spm - expectedSpm) / expectedSpm).toBeLessThan(0.1);
  await expect(page.locator('#metric-spm')).toHaveText(`${Math.round(m.spm)} зн/хв`);
  await expect(page.locator('#verdict')).toContainText('Успішних спроб поспіль: 1 з 3');
});

test('навмисні помилки: зупинка на помилці, помилка не стає правильним символом і лишається в статистиці', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  const text = await startGraded(page, 'en-l01-s1-03');
  const chars = [...text];
  await page.keyboard.type(chars[0]);
  await page.waitForTimeout(60);
  await page.keyboard.type('k'); // хибна клавіша
  await expect(page.locator('.type-status')).toContainText('✗ Помилка: потрібно');
  await expect(page.locator('.type-text .ch.current.error')).toHaveCount(1);
  await expect(page.locator('.type-meta')).toContainText('Набрано: 1 з');
  await page.waitForTimeout(60);
  await page.keyboard.type('k'); // ще одна
  for (const ch of chars.slice(1)) {
    await page.waitForTimeout(60);
    await page.keyboard.type(ch);
  }
  const m = await metrics(page);
  expect(m.errors).toBe(2);
  expect(m.accuracy).toBeCloseTo(((text.length - 2) / text.length) * 100, 1);
  await expect(page.locator('#errors-table')).toContainText('k ×2');
  await expect(page.locator('#metric-errors')).toHaveText('2');
});

test('режим Backspace: k помилок, k−1 виправлено — лічильник показує k, точність (N−k)/N', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  await setSetting(page, 's.stopOnError = false');
  const text = await startGraded(page, 'en-l01-s1-03');
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    await page.waitForTimeout(50);
    if (i === 3 || i === 9) {
      await page.keyboard.type('k');
      await expect(page.locator('.type-text .ch.wrong')).toHaveCount(1);
      await page.waitForTimeout(50);
      await page.keyboard.press('Backspace');
      await expect(page.locator('.type-text .ch.wrong')).toHaveCount(0);
      await page.waitForTimeout(50);
      await page.keyboard.type(chars[i]);
    } else if (i === chars.length - 1) {
      await page.keyboard.type('k'); // остання помилка лишається невиправленою
    } else {
      await page.keyboard.type(chars[i]);
    }
  }
  const m = await metrics(page);
  expect(m.errors).toBe(3);
  expect(m.accuracy).toBeCloseTo(((text.length - 3) / text.length) * 100, 1);
  await expect(page.locator('.tiles')).toContainText('з них невиправлених: 1');
});

test('точність нижча за поріг — вправу не зараховано, серію обнулено, є конкретна порада', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  const id = 'en-l01-s1-03';
  let text = await startGraded(page, id);
  await typeText(page, text, 55);
  await expect(page.locator('#verdict')).toContainText('1 з 3');

  await page.locator('#next-action').click();
  text = await exerciseText(page);
  for (const ch of text) {
    await page.waitForTimeout(55);
    if (ch === 'j') { await page.keyboard.type('k'); await page.waitForTimeout(55); }
    await page.keyboard.type(ch);
  }
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'false');
  await expect(page.locator('#verdict')).toContainText('нижча за поріг 95 %');
  await expect(page.locator('#verdict')).toContainText('Серію успішних спроб обнулено: 0 з 3');
  await expect(page.locator('#advice')).toContainText('Найбільше помилок на клавіші «j»');
  await expect(page.locator('#advice')).toContainText('правий вказівний');
  await expect(page.locator('#next-action')).toHaveText('Вправа на слабке місце');
  expect((await profile(page)).progress.en.exercises[id].streak).toBe(0);

  // Рекомендована дія відкриває вправу саме на цю клавішу.
  await page.locator('#next-action').click();
  await expect(page.locator('h1')).toHaveText('Слабкі місця');
  await expect(page.locator('.lead')).toContainText('«j» — правий вказівний');
  expect(await page.locator('#exercise-preview').textContent()).toMatch(/^jjj jj j /);
});

test('вставка тексту й миттєвий набір не зараховуються', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  const id = 'en-l01-s1-03';
  const text = await startGraded(page, id);

  // 1. Програмна вставка всього тексту одним шматком.
  await page.keyboard.insertText(text);
  await expect(page.locator('.type-status')).toContainText('Вставку тексту відхилено');
  await expect(page.locator('.type-meta')).toContainText('Набрано: 0 з');

  // 2. Подія paste.
  await page.locator('#typing-input').evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await expect(page.locator('.type-meta')).toContainText('Набрано: 0 з');
  expect(await page.locator('#typing-input').inputValue()).toBe('');

  // 3. Миттєва серія натискань без пауз.
  await page.locator('#typing-input').evaluate((el, value) => {
    for (const key of value) el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }, text);
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'false');
  await expect(page.locator('#verdict')).toContainText('швидше, ніж можна набрати руками');
  const saved = await profile(page);
  expect(saved.progress.en.exercises[id].streak).toBe(0);
  expect(saved.progress.en.exercises[id].passed).toBe(false);
});

test('три успішні спроби поспіль відкривають наступну вправу; прогрес переживає перезавантаження', async ({ page }) => {
  await onboard(page, { lang: 'en' });
  const id = 'en-l01-s1-01';
  await page.goto('./#/ex/en-l01-s1-02');
  await expect(page.locator('main')).toContainText('Вправа ще закрита');

  let text = await startGraded(page, id);
  for (let i = 1; i <= 3; i += 1) {
    await typeText(page, text, 55);
    await expect(page.locator('#verdict')).toContainText(`Успішних спроб поспіль: ${i} з 3`);
    if (i < 3) {
      await expect(page.locator('#next-action')).toBeFocused();
      await page.keyboard.press('Enter'); // «Повторити залік»
      text = await exerciseText(page);
    }
  }
  await expect(page.locator('#verdict')).toContainText('Вправу завершено — наступну відкрито');
  await expect(page.locator('#next-action')).toHaveText('Наступна вправа: Нова клавіша «j»');

  await page.reload();
  await page.goto('./#/stage/1');
  const first = page.locator('.ex-item').first();
  await expect(first).toContainText('✓ зараховано');
  await expect(first).toContainText('рекорд');
  await expect(page.locator('.ex-item').nth(1).locator('a')).toHaveAttribute('href', '#/ex/en-l01-s1-02');
  await expect(page.locator('.ex-item').nth(2)).toContainText('закрито');

  await page.goto('./#/stats');
  await expect(page.locator('#history-table tbody tr')).toHaveCount(3);
  const saved = await profile(page);
  expect(saved.progress.en.exercises[id]).toMatchObject({ passed: true, attempts: 3, streak: 3 });
  expect(saved.history).toHaveLength(3);
});

test('тренування показує клавіатуру з підказкою, але нічого не зберігає', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  await page.goto('./#/ex/en-l01-s1-03');
  await page.locator('#start-practice').click();
  await expect(page.locator('#mode-badge')).toHaveText('Тренування — результат не зберігається');
  await expect(page.locator('.kb-key.next')).toHaveCount(1);
  await expect(page.locator('main')).toContainText('Наступна клавіша: «f» — лівий вказівний, домашній ряд.');
  const text = await exerciseText(page);
  await typeText(page, text, 55);
  await expect(page.locator('#verdict')).toContainText('Результат не збережено');
  const saved = await profile(page);
  expect(saved.history).toHaveLength(0);
  expect(saved.progress.en.exercises).toEqual({});
});

test('українська: гама ФІВА ОЛДЖ, кирилиця набирається, і/ї/є/ґ та апостроф не підміняються', async ({ page }) => {
  await onboard(page, { lang: 'uk', level: 'advanced' });
  await expect(page.locator('h1')).toHaveText('Етап 3 · Академія: українська мова');

  // Етап 1: гама домашнього ряду.
  let text = await startGraded(page, 'uk-l05-s1-01');
  expect(text.startsWith('фіва олдж фіва олдж ждло авіф')).toBe(true);
  await typeText(page, text, 55);
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'true');

  // Розкладка перевіряється до старту: латинка не починає спробу.
  text = await startGraded(page, 'uk-l05-s1-01');
  await page.keyboard.type('a');
  await expect(page.locator('.type-status')).toContainText('Схоже, увімкнено іншу розкладку');
  await expect(page.locator('.type-meta')).toContainText('Помилок: 0');

  // Слова з ґ, є, ї, і: «г» замість «ґ» та латинська «i» замість «і» — помилки.
  text = await startGraded(page, 'uk-l20-s2-02');
  expect(text).toMatch(/[ґєїі]/);
  let substitutions = 0;
  for (const ch of text) {
    await page.waitForTimeout(55);
    const wrong = { ґ: 'г', і: 'i', ї: 'і', є: 'е' }[ch];
    if (wrong && substitutions < 2) {
      await page.keyboard.type(wrong);
      await expect(page.locator('.type-text .ch.current.error')).toHaveCount(1);
      substitutions += 1;
      await page.waitForTimeout(55);
    }
    await page.keyboard.type(ch);
  }
  expect((await metrics(page)).errors).toBe(2);

  // Апостроф: типографський варіант зараховується як той самий знак.
  text = await startGraded(page, 'uk-l22-s2-01');
  expect(text).toContain("'");
  await typeText(page, text.replaceAll("'", '’'), 55);
  expect((await metrics(page)).errors).toBe(0);
});

for (const lang of ['en', 'uk']) {
  test(`[${lang}] етап 2: понад 30 слів із DOM складаються лише з відкритих клавіш`, async ({ page }) => {
    await onboard(page, { lang, level: 'advanced' });
    await page.goto('./#/stage/2');
    await expect(page.locator('main h1')).toHaveText('Етап 2 · Слова з вивчених клавіш');
    const lessons = await page.locator('section.lesson').evaluateAll((sections) => sections.slice(0, 5).map((section) => ({
      opened: section.querySelector('[data-opened]').dataset.opened,
      ids: [...section.querySelectorAll('.ex-item a')].map((a) => a.getAttribute('href').replace('#/ex/', '')),
    })));
    const words = [];
    for (const lesson of lessons) {
      for (const id of lesson.ids.slice(0, 2)) {
        await page.goto(`./#/ex/${id}`);
        const text = await page.locator('#exercise-preview').textContent();
        for (const word of text.split(' ')) {
          words.push(word);
          for (const ch of word) expect(lesson.opened, `${id}: «${word}»`).toContain(ch);
        }
      }
    }
    expect(words.length).toBeGreaterThan(30);
    expect(new Set(words).size).toBeGreaterThan(30);
  });

  test(`[${lang}] етап 3: вправа Академії на найчастішу біграму`, async ({ page }) => {
    await onboard(page, { lang, level: 'advanced' });
    await page.goto('./#/academy');
    await expect(page.locator('section.lesson')).toHaveCount(10);
    await expect(page.locator('section.lesson').first()).toContainText('Модуль 1. Найчастіші біграми');
    await expect(page.locator('.hero')).toContainText('успішні спроби поспіль з точністю не нижче 97 %');
    const text = await startGraded(page, `${lang}-a01-01`);
    await expect(page.locator('h1')).toContainText('Біграма');
    await typeText(page, text, 55);
    await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'true');
    await page.goto('./#/academy');
    await expect(page.locator('.ex-item').first()).toContainText('1 з 3 спроб');
  });
}

test('темпова серія: точна, але повільна спроба не зараховується; точна й швидка — зараховується', async ({ page }) => {
  await onboard(page, { lang: 'en', level: 'advanced' });
  let text = await startGraded(page, 'en-a10-01');
  await expect(page.locator('.type-meta')).toContainText('швидкість не нижча за 150 зн/хв');
  await typeText(page, text, 480); // близько 125 зн/хв
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'false');
  await expect(page.locator('#verdict')).toContainText('нижча за цільову 150 зн/хв');
  expect((await metrics(page)).accuracy).toBe(100);

  await page.locator('#next-action').click();
  text = await exerciseText(page);
  await typeText(page, text, 60);
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'true');
});

test('увесь основний шлях проходиться лише з клавіатури, фокус видимий', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#start-beginner')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#continue')).toBeFocused();
  const outline = await page.locator('#continue').evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('#start-graded')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-input')).toBeFocused();
  await typeText(page, await exerciseText(page), 55);
  await expect(page.locator('#next-action')).toBeFocused();

  // Esc виходить із вправи на вступний екран.
  await page.keyboard.press('Enter');
  await expect(page.locator('#typing-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-graded')).toBeFocused();

  // Tab із першого елемента сторінки веде до посилання «Перейти до вмісту».
  await page.goto('about:blank');
  await page.goto('./#/help');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
});

test('усі інтерактивні елементи мають роль і доступне ім\'я', async ({ page }) => {
  await onboard(page, { lang: 'uk', level: 'advanced' });
  for (const route of ['#/', '#/stage/1', '#/academy', '#/session', '#/settings', '#/sources', '#/help', '#/ex/uk-l01-s1-01']) {
    await page.goto(`./${route}`);
    await expect(page.locator('main h1')).toBeVisible();
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [onclick]')]
      .filter((el) => el.type !== 'hidden' && el.offsetParent !== null)
      .filter((el) => {
        const labelled = el.getAttribute('aria-label') || el.textContent.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`));
        const native = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
        return !labelled || (!native && !el.getAttribute('role'));
      })
      .map((el) => el.outerHTML.slice(0, 120)));
    expect(unnamed, route).toEqual([]);
  }
});

for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
  test(`верстка ${width}×${height}: без горизонтальної прокрутки, елементи в межах екрана`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await onboard(page, { lang: 'uk', level: 'advanced' });
    const routes = ['#/', '#/start', '#/stage/1', '#/stage/2', '#/academy', '#/session', '#/stats', '#/settings', '#/sources', '#/help', '#/ex/uk-a09-01'];
    for (const route of routes) {
      await page.goto(`./${route}`);
      await expect(page.locator('main h1')).toBeVisible();
      const overflow = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const outside = [...document.querySelectorAll('main *, header *')]
          .filter((el) => !el.closest('.table-scroll') && el.getBoundingClientRect().right > limit + 1)
          .map((el) => `${el.tagName}.${el.className}`);
        return { scroll: document.documentElement.scrollWidth - limit, outside: outside.slice(0, 5) };
      });
      expect(overflow, route).toEqual({ scroll: 0, outside: [] });
    }
    // Вправа на цьому розмірі: текст видно повністю, набір працює.
    const text = await startGraded(page, 'uk-l05-s1-01');
    await expect(page.locator('#exercise-text')).toBeInViewport();
    await typeText(page, text, 55);
    await expect(page.locator('#verdict')).toBeVisible();
  });
}

test('налаштування: розмір тексту вправи, тема, пороги; значення зберігаються', async ({ page }) => {
  await onboard(page, { lang: 'uk' });
  await page.goto('./#/settings');
  await page.locator('#font-size').fill('40');
  await page.locator('#theme').selectOption('dark');
  await page.locator('#acc-1').fill('50');
  await page.locator('#acc-1').blur();
  await expect(page.locator('#acc-1')).toHaveValue('90'); // поріг точності не опускається нижче 90 %
  await page.locator('#streak').fill('1');
  await page.locator('#streak').blur();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#font-size')).toHaveValue('40');

  await startGraded(page, 'uk-l01-s1-01');
  const size = await page.locator('#exercise-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBe(40);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await expect(page.locator('.type-meta')).toContainText('точність не нижча за 90 %');
});

test('prefers-reduced-motion: анімації вимкнено', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await onboard(page, { lang: 'en' });
  await startGraded(page, 'en-l01-s1-01');
  await page.keyboard.type('f');
  await page.waitForTimeout(50);
  await page.keyboard.type('k');
  const animated = await page.locator('.type-panel').evaluate((el) => el.classList.contains('shake') || getComputedStyle(el).animationName !== 'none');
  expect(animated).toBe(false);
});

test('діагностика радить рівень і відкриває Академію тим, хто вже набирає', async ({ page }) => {
  await page.goto('./');
  await page.locator('#start-diagnostic').click();
  await expect(page.locator('#start-graded')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mode-badge')).toHaveText('Діагностика — без підказок');
  await typeText(page, await exerciseText(page), 55);
  await expect(page.locator('#diagnostic-advice')).toContainText('Ти вже набираєш упевнено');
  await page.locator('#diagnostic-advice button.primary').click();
  await expect(page.locator('h1')).toHaveText('Етап 3 · Академія: українська мова');
  expect((await profile(page)).settings.freeAccess).toBe(true);
});

test('заняття на 15–25 хвилин: розігрів, цільова навичка, закріплення, справжній текст', async ({ page }) => {
  await onboard(page, { lang: 'en' });
  await page.goto('./#/session');
  await expect(page.locator('.steps li')).toHaveCount(4);
  await expect(page.locator('.steps')).toContainText('Розігрів');
  await expect(page.locator('.steps')).toContainText('Цільова навичка');
  await expect(page.locator('.steps')).toContainText('Закріплення');
  await expect(page.locator('.steps')).toContainText('Справжній текст');
  await page.keyboard.press('Enter');
  await expect(page.locator('.badge.stage')).toContainText('Заняття · крок 1 з 4: Розігрів');
  await expect(page.locator('#start-graded')).toBeFocused();
  await page.keyboard.press('Enter');
  await typeText(page, await exerciseText(page), 55);
  await expect(page.locator('#next-action')).toHaveText('Далі за планом заняття');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toContainText('Спроба 2 з 2');
});

test('сторінка джерел і ліцензій показує кожен словник, ревізію, ліцензію та кроки очищення', async ({ page }) => {
  await page.goto('./#/sources');
  await expect(page.locator('#sources-table tbody tr')).toHaveCount(5);
  await expect(page.locator('#sources-table')).toContainText('GPL-3.0');
  await expect(page.locator('#sources-table')).toContainText('MIT');
  await expect(page.locator('#sources-table')).toContainText('ревізія 525f9b560de4');
  await expect(page.locator('main')).toContainText('decontaminated');
  await expect(page.locator('main')).toContainText('CC0-1.0');
});

test('перемикання мови зберігає окремий прогрес кожного курсу', async ({ page }) => {
  await onboard(page, { lang: 'en' });
  const text = await startGraded(page, 'en-l01-s1-01');
  await typeText(page, text, 55);
  await page.goto('./');
  await page.locator('#nav button[data-lang="uk"]').click();
  await expect(page.locator('h1')).toHaveText('Гами — тренажер сенсорного набору'); // для української ще не обрано рівень
  await page.locator('#start-beginner').click();
  await expect(page.locator('h1')).toHaveText('Курс: Українська · ЙЦУКЕН');
  await page.locator('#nav button[data-lang="en"]').click();
  await expect(page.locator('h1')).toHaveText('Курс: English · QWERTY');
  const saved = await profile(page);
  expect(Object.keys(saved.progress.en.exercises)).toEqual(['en-l01-s1-01']);
  expect(saved.progress.uk.exercises).toEqual({});
});

test('axe-core: жодних порушень доступності на ключових екранах, у світлій і темній темах', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const check = async (name) => {
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${name}: ${v.id} — ${v.nodes.map((n) => n.html.slice(0, 100)).join(' | ')}`)).toEqual([]);
  };
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('about:blank');
    await page.goto('./');
    await expect(page.locator('main h1')).toBeVisible();
    if (scheme === 'light') {
      await check('перший запуск');
      await page.locator('#start-advanced').click();
    }
    for (const route of ['#/', '#/stage/1', '#/stage/2', '#/academy', '#/session', '#/settings', '#/sources', '#/help']) {
      await page.goto(`./${route}`);
      await expect(page.locator('main h1')).toBeVisible();
      await check(`${scheme} ${route}`);
    }
    // Вступ → тренування з клавіатурою → залік із помилкою → результат → статистика.
    await page.goto('about:blank');
    await page.goto('./#/ex/uk-l07-s2-01');
    await check(`${scheme} вступ до вправи`);
    await page.locator('#start-practice').click();
    await page.keyboard.type('щ');
    await check(`${scheme} тренування`);
    await page.keyboard.press('Escape');
    await expect(page.locator('#start-graded')).toBeFocused();
    await page.keyboard.press('Enter');
    const text = await exerciseText(page);
    await page.keyboard.type(text[0]);
    await page.waitForTimeout(55);
    await page.keyboard.type('щ');
    await check(`${scheme} залік із помилкою`);
    await typeText(page, text.slice(1), 55);
    await expect(page.locator('#verdict')).toBeVisible();
    await check(`${scheme} результат`);
    await page.goto('./#/stats');
    await expect(page.locator('#history-table')).toBeVisible();
    await check(`${scheme} статистика`);
  }
});

test('після першого завантаження базове навчання працює без мережі', async ({ page, context }) => {
  await onboard(page, { lang: 'uk' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Сервіс-воркер кешує всі файли застосунку під час встановлення.
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('gamy-v1')).keys()).length)).toBeGreaterThan(20);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Курс: Українська · ЙЦУКЕН');
  await page.locator('#continue').click();
  await expect(page.locator('#start-graded')).toBeFocused();
  await page.keyboard.press('Enter');
  await typeText(page, await exerciseText(page), 55);
  await expect(page.locator('#verdict')).toHaveAttribute('data-passed', 'true');
  await page.goto('./#/weak');
  await expect(page.locator('h1')).toHaveText('Слабкі місця');
  await context.setOffline(false);
});
