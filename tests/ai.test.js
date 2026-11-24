import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  nanoAvailability,
  createNanoSession,
  nanoPlan,
  nanoAsk,
  translate,
  translatePlan,
  promptWithTimeout,
  NANO_PLAN_SCHEMA,
  warmTranslator,
  resetTranslators,
} from '../src/ai/nano.js';
import { resolveProvider, planWith, askWith, resetNanoCache, PROVIDER_LABELS } from '../src/ai/provider.js';

const PLAN = {
  headline: 'Poor air tonight',
  schedule: [{ time: '2 pm', title: 'Go out', detail: 'Cleanest window' }],
  perMember: [{ name: 'Dadi', advice: 'Walk at 2 pm' }],
  impactStory: 'Less smog for everyone.',
};

/** Fake Chrome Prompt + Translator APIs that record calls. */
function fakeAI({ availability = 'available', translatorStatus = 'available', reply = JSON.stringify(PLAN) } = {}) {
  const calls = { create: [], prompt: [], translate: [] };
  const session = {
    prompt: async (text, opts) => {
      calls.prompt.push({ text, opts });
      return reply;
    },
    destroy() {},
  };
  return {
    calls,
    LanguageModel: {
      availability: async () => availability,
      create: async (opts) => {
        calls.create.push(opts);
        const monitorTarget = new EventTarget();
        opts.monitor?.(monitorTarget);
        monitorTarget.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.5 }));
        return session;
      },
    },
    Translator: {
      availability: async () => translatorStatus,
      create: async ({ targetLanguage }) => ({
        translate: async (s) => {
          calls.translate.push(targetLanguage);
          return `[${targetLanguage}] ${s}`;
        },
      }),
    },
  };
}

beforeEach(() => {
  resetNanoCache();
  resetTranslators();
});

test('availability reports unavailable without the API or on error', async () => {
  assert.equal(await nanoAvailability({}), 'unavailable');
  assert.equal(await nanoAvailability(fakeAI({ availability: 'downloadable' })), 'downloadable');
  const broken = { LanguageModel: { availability: async () => Promise.reject(new Error('x')) } };
  assert.equal(await nanoAvailability(broken), 'unavailable');
});

test('session is primed with rules and household context, and reports download progress', async () => {
  const ai = fakeAI();
  const progress = [];
  await createNanoSession({ context: { place: 'Delhi' }, onProgress: (f) => progress.push(f), ai });
  const prompts = ai.calls.create[0].initialPrompts;
  assert.equal(prompts[0].role, 'system');
  assert.match(prompts[1].content, /Delhi/);
  assert.deepEqual(progress, [0.5]);
  await assert.rejects(createNanoSession({ context: {}, ai: {} }), /not available/);
});

test('nanoPlan constrains output with a JSON schema and validates it', async () => {
  const ai = fakeAI();
  const session = await createNanoSession({ context: {}, ai });
  const plan = await nanoPlan(session, { members: [] });
  assert.equal(plan.source, 'gemini-nano');
  assert.equal(plan.schedule[0].title, 'Go out');
  assert.deepEqual(ai.calls.prompt[0].opts.responseConstraint, NANO_PLAN_SCHEMA);
});

test('nanoAsk caps question length', async () => {
  const ai = fakeAI({ reply: 'ok' });
  const session = await createNanoSession({ context: {}, ai });
  assert.equal(await nanoAsk(session, 'x'.repeat(5000)), 'ok');
  assert.ok(ai.calls.prompt[0].text.length < 1200);
});

test('translate skips English and unavailable pairs', async () => {
  assert.equal(await translate('hi', 'en', fakeAI()), 'hi');
  assert.equal(await translate('hi', 'ta', fakeAI({ translatorStatus: 'unavailable' })), 'hi');
  assert.equal(await translate('hello', 'hi', fakeAI()), '[hi] hello');
  assert.equal(await translate('hello', 'hi', {}), 'hello');
});

test('translatePlan translates text but keeps names and times', async () => {
  const out = await translatePlan({ source: 'gemini-nano', ...PLAN }, 'hi', fakeAI());
  assert.equal(out.lang, 'hi');
  assert.equal(out.schedule[0].time, '2 pm');
  assert.equal(out.perMember[0].name, 'Dadi');
  assert.match(out.headline, /^\[hi\]/);
  const same = { source: 'gemini-nano', ...PLAN };
  assert.equal(await translatePlan(same, 'en', fakeAI()), same);
});

test('translatePlan also translates health alerts, keeping who and level', async () => {
  const alerts = [{ who: 'Dadi', level: 'high', text: 'Keep the inhaler on hand' }];
  const out = await translatePlan({ source: 'gemini-nano', ...PLAN, alerts }, 'hi', fakeAI());
  assert.deepEqual(out.alerts, [{ who: 'Dadi', level: 'high', text: '[hi] Keep the inhaler on hand' }]);
});

test('provider prefers the cloud key, then on-device Nano, then none', async () => {
  assert.equal(await resolveProvider('KEY', fakeAI()), 'cloud');
  assert.equal(await resolveProvider('', fakeAI({ availability: 'downloadable' })), 'nano');
  assert.equal(await resolveProvider('', {}), 'none');
  assert.ok(PROVIDER_LABELS.nano.includes('no key'));
});

test('planWith(nano) returns a translated on-device plan; none throws', async () => {
  const ai = fakeAI();
  const plan = await planWith({ provider: 'nano', apiKey: '', model: '', context: {}, lang: 'bn', ai });
  assert.equal(plan.source, 'gemini-nano');
  assert.equal(plan.lang, 'bn');
  await assert.rejects(planWith({ provider: 'none', apiKey: '', model: '', context: {}, lang: 'en' }), /No AI/);
});

test('planWith(nano) translates the attached health alerts too', async () => {
  resetNanoCache();
  const alerts = [{ who: 'Dadi', level: 'high', text: 'Keep the inhaler on hand' }];
  const plan = await planWith({
    provider: 'nano',
    apiKey: '',
    model: '',
    context: {},
    lang: 'hi',
    ai: fakeAI(),
    alerts,
  });
  assert.equal(plan.alerts?.[0].text, '[hi] Keep the inhaler on hand');
});

test('planWith(cloud) calls the Gemini API with the key in a header', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(PLAN) }] } }] }),
    };
  };
  const plan = await planWith({ provider: 'cloud', apiKey: 'K', model: '', context: {}, lang: 'hi', fetchImpl });
  assert.equal(plan.source, 'gemini');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'K');
});

test('askWith(nano) reuses one session for the same household', async () => {
  const ai = fakeAI({ reply: 'answer' });
  const base = {
    provider: /** @type {const} */ ('nano'),
    apiKey: '',
    model: '',
    context: { a: 1 },
    lang: 'en',
    history: [],
    ai,
  };
  assert.equal(await askWith({ ...base, question: 'q1' }), 'answer');
  await askWith({ ...base, question: 'q2' });
  assert.equal(ai.calls.create.length, 1);
  await askWith({ ...base, context: { a: 2 }, question: 'q3' });
  assert.equal(ai.calls.create.length, 2);
  await assert.rejects(askWith({ ...base, provider: 'none', question: 'q' }), /No AI/);
});

test('translator is created once per language and reused', async () => {
  const ai = fakeAI();
  let creates = 0;
  const orig = ai.Translator.create;
  ai.Translator.create = async (pair) => {
    creates++;
    return orig(pair);
  };
  warmTranslator('hi', ai);
  await translate('a', 'hi', ai);
  await translate('b', 'hi', ai);
  assert.equal(creates, 1);
});

test('a failed language-pack download falls back to the English plan', async () => {
  const ai = fakeAI();
  ai.Translator.create = async () => {
    throw new Error('Requires a user gesture');
  };
  const out = await translatePlan({ source: 'gemini-nano', ...PLAN }, 'hi', ai);
  assert.equal(out.lang, 'en');
  assert.equal(out.headline, PLAN.headline);
});

test('a translation error returns the original text', async () => {
  const ai = fakeAI();
  ai.Translator.create = async () => ({
    translate: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(await translate('hello', 'ta', ai), 'hello');
});

test('a failed translator is retried on the next call', async () => {
  const ai = fakeAI();
  let attempt = 0;
  const orig = ai.Translator.create;
  ai.Translator.create = async (pair) => {
    attempt++;
    if (attempt === 1) {
      throw new Error('Requires a user gesture');
    }
    return orig(pair);
  };
  assert.equal(await translate('hello', 'hi', ai), 'hello');
  assert.equal(await translate('hello', 'hi', ai), '[hi] hello');
});

test('a stuck on-device prompt is aborted after the timeout', async () => {
  let signal;
  const stuck = {
    prompt: (_text, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    },
  };
  await assert.rejects(promptWithTimeout(stuck, 'hi', 20), /took too long/);
  assert.equal(signal.aborted, true);
});

test('a prompt that answers in time is returned unchanged', async () => {
  const quick = { prompt: async () => 'ok' };
  assert.equal(await promptWithTimeout(quick, 'hi', 1000), 'ok');
});

test('askWith(nano) starts a fresh session after a failed prompt', async () => {
  resetNanoCache();
  let created = 0;
  const ai = {
    LanguageModel: {
      availability: async () => 'available',
      create: async () => {
        created += 1;
        return { prompt: async () => (created === 1 ? Promise.reject(new Error('device busy')) : 'fine') };
      },
    },
  };
  const opts = { provider: 'nano', apiKey: '', model: '', context: {}, lang: 'en', history: [], question: 'q', ai };
  await assert.rejects(askWith(opts), /device busy/);
  assert.equal(await askWith(opts), 'fine');
  assert.equal(created, 2);
});
