import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, demoState, saveApiKey, loadApiKey } from '../src/store.js';
import { tokenizeRichText } from '../src/dom.js';
import { searchPlaces, fetchAirQuality, validCoords, clearCache } from '../src/api.js';

test('sanitizeState rejects junk and clamps values', () => {
  const s = sanitizeState({
    home: { windows: 'sideways', purifier: 'yes', sources: ['incense', 'nuclear', 'incense'] },
    members: [
      {
        id: '<script>',
        name: 'x'.repeat(100),
        age: 'alien',
        commuteMode: 'rocket',
        commuteHours: 99,
        outdoorHours: -5,
        conditions: ['asthma', 'flu'],
        mask: 'n95',
      },
    ],
  });
  assert.equal(s.home.windows, 'open');
  assert.equal(s.home.purifier, true);
  assert.deepEqual(s.home.sources, ['incense']);
  const m = s.members[0];
  assert.notEqual(m.id, '<script>');
  assert.equal(m.name.length, 30);
  assert.equal(m.age, 'adult');
  assert.equal(m.commuteMode, 'none');
  assert.equal(m.commuteHours, 6);
  assert.equal(m.outdoorHours, 0);
  assert.deepEqual(m.conditions, ['asthma']);
  assert.equal(m.mask, 'n95');
});

test('sanitizeState falls back to the demo household', () => {
  assert.equal(sanitizeState(null).members.length, demoState().members.length);
  assert.ok(sanitizeState({ members: Array(50).fill({}) }).members.length <= 10);
});

test('API key storage is a no-op without browser storage', () => {
  saveApiKey('k', false);
  assert.equal(loadApiKey(), '');
});

test('rich text tokeniser handles bullets and bold without HTML', () => {
  const blocks = tokenizeRichText('Hello **world**\n- one\n- <b>two</b>\n\nBye');
  assert.equal(blocks[0].type, 'p');
  assert.deepEqual(blocks[0].items[0][1], { bold: true, text: 'world' });
  assert.equal(blocks[1].type, 'ul');
  assert.equal(blocks[1].items[1][0].text, '<b>two</b>');
  assert.equal(blocks[2].type, 'p');
});

test('coordinate validation', () => {
  assert.ok(validCoords(28.6, 77.2));
  assert.ok(!validCoords(91, 0));
  assert.ok(!validCoords(NaN, 0));
});

test('air quality request uses unixtime and caches', async () => {
  clearCache();
  let calls = 0;
  const f = async (url) => {
    calls++;
    assert.match(url, /timeformat=unixtime/);
    assert.match(url, /hourly=pm2_5/);
    return { ok: true, json: async () => ({ hourly: { time: [], pm2_5: [] } }) };
  };
  await fetchAirQuality(28.6, 77.2, f);
  await fetchAirQuality(28.6, 77.2, f);
  assert.equal(calls, 1);
  await assert.rejects(fetchAirQuality(100, 0, f), /Invalid/);
});

test('place search ignores short queries and filters bad coords', async () => {
  clearCache();
  assert.deepEqual(await searchPlaces('a'), []);
  const f = async () => ({
    ok: true,
    json: async () => ({
      results: [
        { name: 'Delhi', latitude: 28.6, longitude: 77.2 },
        { name: 'Bad', latitude: 999, longitude: 0 },
      ],
    }),
  });
  const r = await searchPlaces('Delhi', f);
  assert.equal(r.length, 1);
});

test('HTTP errors are reported', async () => {
  clearCache();
  const f = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(fetchAirQuality(10, 10, f), /503/);
});

test('forecast cache helpers are safe without storage', async () => {
  const { saveForecast, loadForecast } = await import('../src/store.js');
  saveForecast({ latitude: 1, longitude: 2 }, { hourly: {} });
  assert.equal(loadForecast({ latitude: 1, longitude: 2 }), null);
});

test('forecast cache returns fresh same-place data only', async () => {
  const mem = new Map();
  globalThis.localStorage = {
    setItem: (k, v) => mem.set(k, String(v)),
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    removeItem: (k) => mem.delete(k),
  };
  try {
    const { saveForecast, loadForecast } = await import('../src/store.js');
    const place = { latitude: 28.6, longitude: 77.2 };
    saveForecast(place, { ok: 1 }, 1000);
    assert.deepEqual(loadForecast(place, 2000), { json: { ok: 1 }, at: 1000 });
    assert.equal(loadForecast({ latitude: 19, longitude: 72 }, 2000), null);
    assert.equal(loadForecast(place, 1000 + 25 * 3600 * 1000), null);
  } finally {
    delete globalThis.localStorage;
  }
});
