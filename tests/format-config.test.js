import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, placeLabel, memberSummary, forecastSummary, CONDITIONS } from '../src/format.js';
import { isValidModel, DEFAULT_MODEL, MODEL_PATTERN } from '../src/config.js';
import { buildRequestBody, PLAN_SCHEMA, SYSTEM_INSTRUCTION } from '../src/gemini.js';
import { suggestedQuestions } from '../src/ui/assistant-view.js';
import { concentrations } from '../src/exposure.js';

test('fmt uses fixed decimals', () => {
  assert.equal(fmt(1234.567), '1,235');
  assert.equal(fmt(2.345, 1), '2.3');
  assert.equal(fmt(0, 2), '0.00');
});

test('placeLabel removes blanks and repeats', () => {
  assert.equal(placeLabel({ name: 'Delhi', admin1: 'Delhi', country: 'India' }), 'Delhi, India');
  assert.equal(placeLabel({ name: 'Pune', admin1: '', country: 'India' }), 'Pune, India');
  assert.equal(placeLabel({}), '');
});

test('memberSummary describes a member in one line', () => {
  const s = memberSummary({
    id: 'x',
    name: 'Dadi',
    age: 'senior',
    conditions: ['asthma'],
    commuteMode: 'none',
    commuteHours: 0,
    outdoorHours: 1,
    outdoorTime: 'morning',
    outdoorActivity: 'light',
    mask: 'none',
  });
  assert.match(s, /Senior/);
  assert.match(s, /1 h outdoors/);
  assert.match(s, new RegExp(CONDITIONS.asthma.replace('/', '\\/')));
});

test('forecastSummary reports range and cleanest window', () => {
  const hours = [
    { time: new Date(), pm25: 40 },
    { time: new Date(), pm25: 120 },
  ];
  assert.match(forecastSummary(hours, '2 pm – 4 pm'), /40 to 120.*2 pm – 4 pm/);
  assert.equal(forecastSummary([]), 'No forecast data.');
});

test('model names are validated against path injection', () => {
  assert.ok(isValidModel(DEFAULT_MODEL));
  assert.ok(!isValidModel('../../v1/keys'));
  assert.ok(!isValidModel('a b'));
  assert.ok(!isValidModel(42));
  assert.ok(MODEL_PATTERN instanceof RegExp);
});

test('request body carries the system instruction and schema only for plans', () => {
  const turns = [{ role: /** @type {const} */ ('user'), text: 'hi' }];
  const plan = buildRequestBody(turns, true);
  const chat = buildRequestBody(turns, false);
  assert.equal(plan.systemInstruction.parts[0].text, SYSTEM_INSTRUCTION);
  assert.deepEqual(plan.generationConfig.responseSchema, PLAN_SCHEMA);
  assert.equal(chat.generationConfig.responseSchema, undefined);
  assert.equal(chat.contents[0].parts[0].text, 'hi');
});

test('suggested questions name a sensitive member first', () => {
  const qs = suggestedQuestions([
    {
      id: '1',
      name: 'Rahul',
      age: 'adult',
      conditions: [],
      commuteMode: 'none',
      commuteHours: 0,
      outdoorHours: 0,
      outdoorTime: 'morning',
      outdoorActivity: 'light',
      mask: 'none',
    },
    {
      id: '2',
      name: 'Aarav',
      age: 'child',
      conditions: [],
      commuteMode: 'none',
      commuteHours: 0,
      outdoorHours: 0,
      outdoorTime: 'morning',
      outdoorActivity: 'light',
      mask: 'none',
    },
  ]);
  assert.match(qs[0], /Aarav/);
  assert.match(suggestedQuestions([])[0], /my family/);
});

test('concentrations: purifier halves indoor sources, timing overrides outdoor level', () => {
  const m = { outdoorTime: 'best', outdoorHours: 1 };
  const env = { dailyMean: 100, commuteMean: 120, outdoorMeanFor: () => 40 };
  const plain = concentrations(m, { windows: 'open', purifier: false, sources: ['incense'] }, env);
  const filtered = concentrations(m, { windows: 'open', purifier: true, sources: ['incense'] }, env);
  assert.equal(plain.outdoor, 40);
  assert.equal(plain.commute, 120);
  assert.ok(filtered.indoor < plain.indoor);
});

test('planToText produces a shareable summary', async () => {
  const { planToText } = await import('../src/format.js');
  const text = planToText(
    {
      source: 'offline',
      headline: 'Poor air',
      schedule: [{ time: '2 pm – 4 pm', title: 'Go out', detail: 'Cleanest window.' }],
      perMember: [{ name: 'Dadi', advice: 'Walk at 2 pm.' }],
    },
    'New Delhi, India',
    'https://example.org/',
  );
  assert.match(text, /^SaansSaathi clean-air plan for New Delhi, India/);
  assert.match(text, /• 2 pm – 4 pm: Go out/);
  assert.match(text, /• Dadi: Walk at 2 pm\./);
  assert.match(text, /Plan yours: https:\/\/example\.org\//);
  assert.doesNotMatch(text, /\n\n\n/);
});

test('whatsappLink encodes text', async () => {
  const { whatsappLink } = await import('../src/ui/share.js');
  assert.equal(whatsappLink('a b&c'), 'https://wa.me/?text=a%20b%26c');
});
