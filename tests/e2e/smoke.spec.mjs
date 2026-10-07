import { expect, test } from '@playwright/test';

test('smoke', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('./');
  await expect(page.locator('h1')).toBeVisible();
  console.log('H1:', await page.locator('h1').textContent());
  await page.screenshot({ path: 'test-results/01-onboarding.png', fullPage: true });
  await page.click('#start-beginner');
  await expect(page.locator('#continue')).toBeVisible();
  await page.screenshot({ path: 'test-results/02-home.png', fullPage: true });
  await page.click('#continue');
  await expect(page.locator('#start-graded')).toBeFocused();
  await page.screenshot({ path: 'test-results/03-intro.png', fullPage: true });
  await page.keyboard.press('Enter');
  const text = await page.locator('#exercise-text').getAttribute('data-text');
  console.log('TEXT:', text);
  await page.screenshot({ path: 'test-results/04-typing.png', fullPage: true });
  await page.keyboard.type(text, { delay: 60 });
  await expect(page.locator('#verdict')).toBeVisible();
  await page.screenshot({ path: 'test-results/05-result.png', fullPage: true });
  console.log('VERDICT:', await page.locator('#verdict').textContent());
  console.log('METRICS:', JSON.stringify(await page.locator('#metrics').evaluate((el) => ({ ...el.dataset }))));
  for (const route of ['#/stage/1', '#/stage/2', '#/academy', '#/session', '#/stats', '#/settings', '#/sources', '#/help', '#/weak']) {
    await page.goto(`./${route}`);
    await expect(page.locator('main h1')).toBeVisible();
    await page.screenshot({ path: `test-results/route-${route.replace(/[#/]/g, '_')}.png`, fullPage: true });
    console.log(route, '=>', await page.locator('main h1').textContent());
  }
  console.log('ERRORS:', JSON.stringify(errors, null, 1));
});
