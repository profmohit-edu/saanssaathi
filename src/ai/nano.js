/**
 * On-device AI via Chrome's built-in APIs: Gemini Nano (Prompt API) for the
 * plan and chat, and the Translator API for Indian languages. Needs no API
 * key, and no data leaves the device. Every function takes the API object as a
 * parameter so it can be tested with fakes.
 * @module ai/nano
 */
import { SYSTEM_INSTRUCTION, buildPlanPrompt, parsePlan } from '../gemini.js';

/** Gemini Nano output languages supported by the Prompt API. */
const NANO_LANG = 'en';

/**
 * Standard JSON Schema (lowercase types) for the plan, used as the Prompt API
 * `responseConstraint` so Nano returns parseable JSON.
 */
export const NANO_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    headline: { type: 'string' },
    schedule: {
      type: 'array',
      items: {
        type: 'object',
        properties: { time: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } },
        required: ['time', 'title', 'detail'],
      },
    },
    perMember: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, advice: { type: 'string' } },
        required: ['name', 'advice'],
      },
    },
    impactStory: { type: 'string' },
  },
  required: ['headline', 'schedule', 'perMember', 'impactStory'],
});

/**
 * @typedef {object} BuiltInAI
 * @property {any} [LanguageModel] Chrome Prompt API
 * @property {any} [Translator] Chrome Translator API
 */

/** @returns {BuiltInAI} the real browser globals */
export function browserAI() {
  const g = /** @type {any} */ (globalThis);
  return { LanguageModel: g.LanguageModel, Translator: g.Translator };
}

/**
 * Whether Gemini Nano can be used: 'available', 'downloadable', 'downloading' or 'unavailable'.
 * @param {BuiltInAI} [ai]
 * @returns {Promise<string>}
 */
export async function nanoAvailability(ai = browserAI()) {
  if (!ai.LanguageModel?.availability) {
    return 'unavailable';
  }
  try {
    return await ai.LanguageModel.availability({ expectedOutputs: [{ type: 'text', languages: [NANO_LANG] }] });
  } catch {
    return 'unavailable';
  }
}

/**
 * Creates a Gemini Nano session primed with SaansSaathi's rules and the
 * household context. Must be called from a user gesture the first time,
 * because Chrome downloads the model then.
 * @param {object} o
 * @param {object} o.context grounding JSON from buildContext
 * @param {(fraction: number) => void} [o.onProgress] model download progress, 0–1
 * @param {BuiltInAI} [o.ai]
 */
export async function createNanoSession({ context, onProgress, ai = browserAI() }) {
  if (!ai.LanguageModel?.create) {
    throw new Error('On-device Gemini Nano is not available in this browser.');
  }
  return ai.LanguageModel.create({
    initialPrompts: [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: `Household context (JSON):\n${JSON.stringify(context)}` },
      { role: 'assistant', content: 'Understood. I will use these numbers.' },
    ],
    expectedInputs: [{ type: 'text', languages: [NANO_LANG] }],
    expectedOutputs: [{ type: 'text', languages: [NANO_LANG] }],
    monitor(/** @type {EventTarget} */ m) {
      m.addEventListener('downloadprogress', (/** @type {any} */ e) => onProgress?.(Number(e.loaded) || 0));
    },
  });
}

/**
 * Writes the plan on-device with a JSON-schema constraint.
 * @param {{prompt: (text: string, opts?: object) => Promise<string>}} session
 * @param {object} context
 */
export async function nanoPlan(session, context) {
  const text = await session.prompt(buildPlanPrompt(/** @type {any} */ (context), NANO_LANG), {
    responseConstraint: NANO_PLAN_SCHEMA,
  });
  return { ...parsePlan(text), source: /** @type {const} */ ('gemini-nano') };
}

/**
 * One chat answer on-device. The session keeps the conversation history.
 * @param {{prompt: (text: string) => Promise<string>}} session
 * @param {string} question
 */
export function nanoAsk(session, question) {
  return session.prompt(`${String(question).slice(0, 1000)}\nAnswer in under 150 words using the household numbers.`);
}

/**
 * Translates text on-device. Returns the input unchanged for English or when
 * the language pair is unavailable.
 * @param {string} text
 * @param {string} target BCP-47 language code
 * @param {BuiltInAI} [ai]
 * @returns {Promise<string>}
 */
export async function translate(text, target, ai = browserAI()) {
  if (!text || target === 'en' || !ai.Translator?.create) {
    return text;
  }
  const pair = { sourceLanguage: 'en', targetLanguage: target };
  const status = await ai.Translator.availability(pair).catch(() => 'unavailable');
  if (status === 'unavailable') {
    return text;
  }
  const translator = await ai.Translator.create(pair);
  return translator.translate(text);
}

/**
 * Translates every user-visible string of a plan.
 * @param {import('../types.js').Plan} plan
 * @param {string} target
 * @param {BuiltInAI} [ai]
 * @returns {Promise<import('../types.js').Plan>}
 */
export async function translatePlan(plan, target, ai = browserAI()) {
  if (target === 'en') {
    return plan;
  }
  const t = (/** @type {string | undefined} */ s) => translate(s ?? '', target, ai);
  const [headline, impactStory] = await Promise.all([t(plan.headline), t(plan.impactStory)]);
  const schedule = await Promise.all(
    plan.schedule.map(async (s) => ({ time: s.time, title: await t(s.title), detail: await t(s.detail) })),
  );
  const perMember = await Promise.all(
    (plan.perMember ?? []).map(async (m) => ({ name: m.name, advice: await t(m.advice) })),
  );
  return { ...plan, headline, impactStory, schedule, perMember, lang: target };
}
