import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContext,
  buildPlanPrompt,
  parsePlan,
  extractText,
  generate,
  generatePlan,
  ask,
  API_BASE,
} from '../src/gemini.js';
import { buildEnvironment } from '../src/environment.js';
import { householdDose } from '../src/exposure.js';
import { rankSwaps } from '../src/swaps.js';
import { smogSeries, demoMembers, openHome } from './fixtures.js';

const env = buildEnvironment(smogSeries(), new Date(2026, 10, 24, 0, 30));
const state = { members: demoMembers(), home: openHome() };
const ctx = buildContext({
  place: 'Delhi',
  env,
  state,
  dose: householdDose(state.members, state.home, env),
  swaps: rankSwaps(state, env),
});

function mockFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => payload };
  };
  fn.calls = calls;
  return fn;
}

test('context carries computed numbers for grounding', () => {
  assert.equal(ctx.members.length, 2);
  assert.ok(ctx.members[0].inhaledUgPerDay > 0);
  assert.ok(ctx.rankedSwaps.length > 0);
  assert.equal(ctx.pm25.whoDailyGuideline, 15);
});

test('plan prompt names the language and embeds context', () => {
  const p = buildPlanPrompt(ctx, 'hi');
  assert.match(p, /Hindi/);
  assert.match(p, /Rahul/);
});

test('parsePlan validates and truncates', () => {
  const plan = parsePlan(
    '```json\n{"headline":"h","schedule":[{"time":"2 pm","title":"t","detail":"d"}],"perMember":[],"impactStory":"s"}\n```',
  );
  assert.equal(plan.source, 'gemini');
  assert.equal(plan.schedule[0].time, '2 pm');
  assert.throws(() => parsePlan(''));
  assert.throws(() => parsePlan('{"headline":"x"}'));
});

test('extractText skips thought parts and reports blocks', () => {
  assert.equal(
    extractText({ candidates: [{ content: { parts: [{ text: 'a', thought: true }, { text: 'b' }] } }] }),
    'b',
  );
  assert.throws(() => extractText({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
});

test('API key goes in a header, never the URL', async () => {
  const f = mockFetch({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  await generate({ apiKey: 'SECRET', turns: [{ role: 'user', text: 'hi' }], fetchImpl: f });
  assert.ok(!f.calls[0].url.includes('SECRET'));
  assert.ok(f.calls[0].url.startsWith(API_BASE));
  assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'SECRET');
  const body = JSON.parse(f.calls[0].init.body);
  assert.ok(body.systemInstruction);
  assert.equal(body.generationConfig.temperature, undefined);
});

test('generate rejects missing key, bad model and model-final turns', async () => {
  await assert.rejects(generate({ apiKey: '', turns: [{ role: 'user', text: 'x' }] }), /API key/);
  await assert.rejects(
    generate({ apiKey: 'k', model: '../evil', turns: [{ role: 'user', text: 'x' }] }),
    /Invalid model/,
  );
  await assert.rejects(generate({ apiKey: 'k', turns: [{ role: 'model', text: 'x' }] }), /user/);
});

test('HTTP errors surface the API message', async () => {
  const f = mockFetch({ error: { message: 'API key not valid' } }, { ok: false, status: 400 });
  await assert.rejects(
    generate({ apiKey: 'k', turns: [{ role: 'user', text: 'x' }], fetchImpl: f }),
    /API key not valid/,
  );
});

test('generatePlan requests JSON with a schema', async () => {
  const plan = {
    headline: 'h',
    schedule: [{ time: '1 pm', title: 't', detail: 'd' }],
    perMember: [{ name: 'Rahul', advice: 'a' }],
    impactStory: 's',
  };
  const f = mockFetch({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }] });
  const out = await generatePlan({ apiKey: 'k', context: ctx, lang: 'en', fetchImpl: f });
  assert.equal(out.perMember[0].name, 'Rahul');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.responseSchema);
});

test('ask keeps history short and ends with the user turn', async () => {
  const f = mockFetch({ candidates: [{ content: { parts: [{ text: 'answer' }] } }] });
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: String(i) }));
  const a = await ask({ apiKey: 'k', context: ctx, lang: 'ta', history, question: 'q?', fetchImpl: f });
  assert.equal(a, 'answer');
  const body = JSON.parse(f.calls[0].init.body);
  assert.ok(body.contents.length <= 11);
  assert.equal(body.contents.at(-1).role, 'user');
  assert.match(body.contents[0].parts[0].text, /Tamil/);
});
