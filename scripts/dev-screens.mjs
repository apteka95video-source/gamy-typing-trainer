#!/usr/bin/env node
// Допоміжний скрипт розробника: знімки ключових екранів і перевірка контрасту (WCAG AA).
//   node scripts/dev-screens.mjs [каталог]   — сервер має бути запущений на http://localhost:8173
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'test-results/screens';
const base = process.env.BASE_URL ?? 'http://localhost:8173/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

async function type(page, text, delay = 30, mistakes = {}) {
  for (const ch of text) {
    if (mistakes[ch]) { await page.keyboard.type(mistakes[ch]); await page.waitForTimeout(delay); mistakes[ch] = null; }
    await page.keyboard.type(ch);
    await page.waitForTimeout(delay);
  }
}

/** Контраст тексту кожного видимого елемента з власним текстом відносно фактичного фону. */
const contrastAudit = () => {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[,/ ]+/).filter(Boolean);
    return { r: +r, g: +g, b: +b, a: +a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const background = (el) => {
    const layers = [];
    for (let node = el; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) layers.push(color);
      if (color && color.a === 1) break;
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) result = blend(layer, result);
    return result;
  };
  const failures = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (!own || el.offsetParent === null || el.closest('svg')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const fg = parse(style.color);
    const bg = background(el);
    const text = blend({ ...fg, a: fg.a * Number(style.opacity) }, bg);
    const [hi, lo] = [lum(text), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) failures.push(`${ratio.toFixed(2)} ${el.tagName}.${el.className} «${el.textContent.trim().slice(0, 30)}»`);
  }
  return [...new Set(failures)];
};

for (const scheme of ['light', 'dark']) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'uk-UA' });
    const page = await context.newPage();
    const shot = async (name) => page.screenshot({ path: `${out}/${scheme}-${width}-${name}.png`, fullPage: true });
    const audit = async (name) => {
      const failures = await page.evaluate(contrastAudit);
      console.log(`${failures.length ? '✖' : '✔'} контраст ${scheme} ${width} ${name}${failures.length ? `\n    ${failures.join('\n    ')}` : ''}`);
    };
    const visit = async (route, name) => {
      await page.goto('about:blank');
      await page.goto(`${base}${route}`);
      await page.locator('main h1').waitFor();
      await shot(name);
      await audit(name);
    };

    await visit('', 'onboarding');
    await page.locator('#start-advanced').click();
    await visit('#/ex/uk-l07-s1-01', 'intro');
    await page.locator('#start-practice').click();
    await type(page, (await page.locator('#exercise-text').getAttribute('data-text')).slice(0, 6));
    await shot('practice');
    await audit('practice');
    await visit('#/ex/uk-l07-s2-01', 'intro-words');
    await page.keyboard.press('Enter');
    const text = await page.locator('#exercise-text').getAttribute('data-text');
    await type(page, text.slice(0, 9), 30, { [text[4]]: 'щ' });
    await page.keyboard.type('щ');
    await shot('typing-error');
    await audit('typing-error');
    await type(page, text.slice(9), 30, { о: 'л', а: 'ф' });
    await page.locator('#verdict').waitFor();
    await shot('result');
    await audit('result');
    for (const [route, name] of [['#/', 'home'], ['#/stage/2', 'stage2'], ['#/academy', 'academy'], ['#/session', 'session'], ['#/stats', 'stats'], ['#/settings', 'settings'], ['#/sources', 'sources'], ['#/help', 'help']]) {
      await visit(route, name);
    }
    await context.close();
  }
}
await browser.close();
