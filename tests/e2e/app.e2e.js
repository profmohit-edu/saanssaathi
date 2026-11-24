/**
 * End-to-end smoke tests in a real Chromium: the page loads, the model runs on
 * a recorded Delhi forecast, controls work, labels exist, and the app falls
 * back to the saved forecast when the air-quality service is down.
 * Run with `npm run test:e2e` (needs `npx playwright install chromium`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { browser, openApp, startHarness, stopHarness } from './harness.js';

before(startHarness);
after(stopHarness);

test('loads the forecast and computes a Breath Budget per person', async () => {
  const { page, ctx, errors } = await openApp();
  await page.waitForSelector('.aqi-num');
  assert.match(await page.textContent('#air-now'), /Cleanest 2 hours: 2 pm – 4 pm/);
  assert.equal(await page.locator('.budget-row').count(), 4);
  assert.ok((await page.locator('.swap').count()) >= 5);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('ticking a swap changes the combined total', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.swap');
  const initial = await page.textContent('#swap-total');
  await page.locator('.swap-title').last().click();
  assert.notEqual(await page.textContent('#swap-total'), initial);
  await ctx.close();
});

test('every form control has an accessible label', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.member');
  const unlabeled = await page.$$eval('input, select', (els) =>
    els
      .filter((e) => e.type !== 'hidden' && !e.labels?.length && !e.getAttribute('aria-label'))
      .map((e) => e.id || e.name),
  );
  assert.deepEqual(unlabeled, []);
  await ctx.close();
});

test('falls back to the saved forecast when the service is down', async () => {
  const context = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
  const first = await openApp({ context });
  await first.page.waitForSelector('.aqi-num');
  await first.page.close();
  const second = await openApp({ context, airDown: true });
  await second.page.waitForSelector('.offline-note');
  assert.match(await second.page.textContent('.offline-note'), /Offline: showing the forecast saved at/);
  await context.close();
});

test('without a key or on-device model, AI buttons open settings instead of failing', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.swap');
  await page.evaluate(() => {
    delete globalThis.LanguageModel;
  });
  await page.click('#gen-plan');
  assert.equal(await page.evaluate(() => document.getElementById('settings').open), true);
  await ctx.close();
});
