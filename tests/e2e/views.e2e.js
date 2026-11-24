/**
 * Browser tests for each view: place search, household editor, plan and
 * guidance, Gemini (stubbed) plan and chat, settings, share and geolocation.
 * Run with `npm run test:e2e`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fulfillJson, openApp, startHarness, stopHarness } from './harness.js';

before(startHarness);
after(stopHarness);

const PLACES = {
  results: [
    { name: 'Lucknow', admin1: 'Uttar Pradesh', country: 'India', latitude: 26.85, longitude: 80.95 },
    { name: 'Lucknow', admin1: 'Ontario', country: 'Canada', latitude: 43.96, longitude: -81.52 },
  ],
};

const GEMINI_PLAN = {
  headline: 'Poor air tonight, cleaner after lunch',
  schedule: [{ time: '2 pm – 4 pm', title: 'Walk with Dadi', detail: 'Cleanest stretch of the day.' }],
  perMember: [{ name: 'Aarav', advice: 'Play indoors after 8 pm.' }],
  impactStory: 'Your swaps cut the family dose by a third.',
};

/**
 * Waits until the household total differs from `previous`.
 * @param {import('playwright').Page} page
 * @param {string | null} previous
 */
const totalChangedFrom = (page, previous) =>
  page.waitForFunction((prev) => document.querySelector('.budget-headline')?.textContent !== prev, previous);

/** Gemini generateContent reply carrying `text`. @param {string} text */
const geminiReply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

/**
 * Saves a Gemini key through the settings dialog and stubs the API.
 * @param {import('playwright').Page} page
 */
async function useStubbedGemini(page) {
  const calls = [];
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    const body = route.request().postDataJSON();
    calls.push({ key: route.request().headers()['x-goog-api-key'], body });
    const wantsJson = body.generationConfig?.responseMimeType === 'application/json';
    return fulfillJson(route, geminiReply(wantsJson ? JSON.stringify(GEMINI_PLAN) : 'Yes, 2 pm to 4 pm is best.'));
  });
  await page.click('#open-settings');
  await page.fill('#api-key', 'test-key-123');
  await page.click('#save-settings');
  return calls;
}

test('place search works with the keyboard and loads the chosen city', async () => {
  const { page, ctx, errors } = await openApp();
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => fulfillJson(route, PLACES));
  await page.waitForSelector('.aqi-num');
  await page.fill('#place-input', 'Lucknow');
  await page.waitForSelector('#place-results li[role="option"]');
  assert.equal(await page.getAttribute('#place-input', 'aria-expanded'), 'true');
  await page.press('#place-input', 'ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#place-input'), 'Lucknow, Uttar Pradesh, India');
  assert.equal(await page.isHidden('#place-results'), true);
  await page.waitForSelector('.aqi-num');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('place search shows a message when nothing matches', async () => {
  const { page, ctx } = await openApp();
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => fulfillJson(route, {}));
  await page.fill('#place-input', 'Nowhereville');
  await page.press('#place-input', 'Enter');
  await page.waitForSelector('#place-results .empty');
  assert.match(await page.textContent('#place-results'), /No matching places/);
  await ctx.close();
});

test('editing, adding and removing family members updates the Breath Budget', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.budget-row');
  const initial = await page.textContent('.budget-headline');
  await page.selectOption('#members select >> nth=1', { label: 'Metro' });
  await totalChangedFrom(page, initial);
  await page.click('#add-member');
  await page.waitForFunction(() => document.querySelectorAll('.budget-row').length === 5);
  const added = page.locator('#members details.member').last();
  await added.locator('summary').click();
  await added.locator('button', { hasText: 'Remove' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.budget-row').length === 4);
  await ctx.close();
});

test('number fields reject impossible hours without changing the dose', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.budget-row');
  const field = page.locator('#members input[type="number"]').first();
  const initial = await page.textContent('.budget-headline');
  await field.fill('99');
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.textContent('.budget-headline'), initial);
  await ctx.close();
});

test('home settings change the indoor dose', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.budget-row');
  const initial = await page.textContent('.budget-headline');
  await page.click('#home-purifier');
  await totalChangedFrom(page, initial);
  await ctx.close();
});

test('the built-in plan, guidance and chart table are rendered', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('#plan-out .timeline li');
  assert.ok((await page.locator('#plan-out .timeline li').count()) >= 3);
  assert.ok((await page.locator('#hacks > *').count()) > 0);
  assert.ok((await page.locator('#myths > *').count()) > 0);
  assert.ok((await page.locator('#community li').count()) > 0);
  assert.ok((await page.locator('#chart-table tr').count()) > 10);
  assert.ok((await page.locator('#chart rect').count()) > 10);
  await ctx.close();
});

test('with a Gemini key, the plan comes from Gemini and the key goes in a header', async () => {
  const { page, ctx, errors } = await openApp();
  await page.waitForSelector('.swap');
  const calls = await useStubbedGemini(page);
  await page.click('#gen-plan');
  await page.waitForSelector('text=Walk with Dadi');
  assert.equal(calls[0].key, 'test-key-123');
  assert.doesNotMatch(JSON.stringify(calls[0].body), /test-key-123/);
  assert.match(await page.textContent('#plan-out'), /Poor air tonight/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('the chat answers a suggested question through Gemini', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.swap');
  await page.waitForSelector('#suggestions button');
  await useStubbedGemini(page);
  await page.locator('#suggestions button').first().click();
  await page.waitForSelector('text=Yes, 2 pm to 4 pm is best.');
  assert.ok((await page.locator('#chat-log .bubble').count()) >= 2);
  await ctx.close();
});

test('model text is rendered as text, never as HTML', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.swap'); // forecast loaded, so the chat can answer
  await page.route('https://generativelanguage.googleapis.com/**', (route) =>
    fulfillJson(route, geminiReply('<img src=x onerror="window.__pwned=1"> **safe**')),
  );
  await page.click('#open-settings');
  await page.fill('#api-key', 'k');
  await page.click('#save-settings');
  await page.fill('#chat-input', 'test');
  await page.press('#chat-input', 'Enter');
  await page.waitForSelector('#chat-log strong');
  assert.equal(await page.locator('#chat-log img').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__pwned), undefined);
  await ctx.close();
});

test('share falls back to a WhatsApp link when the share sheet is unavailable', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('#plan-out .timeline li');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    globalThis.__opened = [];
    window.open = (url) => {
      globalThis.__opened.push(String(url));
      return null;
    };
  });
  await page.click('#share-plan');
  const opened = await page.evaluate(() => globalThis.__opened);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^https:\/\/wa\.me\/\?text=/);
  await ctx.close();
});

test('denied geolocation shows a helpful message', async () => {
  const { page, ctx } = await openApp();
  await page.waitForSelector('.aqi-num');
  await page.click('#geo-btn');
  await page.waitForSelector('#air-now .error');
  assert.match(await page.textContent('#air-now'), /search for your city/i);
  await ctx.close();
});

test('the skip link moves keyboard users to the main content', async () => {
  const { page, ctx } = await openApp();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'main');
  await ctx.close();
});

test('the layout fits a 360 px phone screen without sideways scrolling', async () => {
  const { page, ctx } = await openApp({ viewport: { width: 360, height: 740 } });
  await page.waitForSelector('.budget-row');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await ctx.close();
});
