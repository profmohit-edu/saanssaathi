/**
 * Chooses and drives the AI backend:
 *  - "cloud": Gemini API with the user's own key (best quality, any language)
 *  - "nano":  Gemini Nano built into Chrome (no key, private, on-device),
 *             with on-device translation for Indian languages
 *  - "none":  no AI available; the app falls back to its offline planner
 * @module ai/provider
 */
import { generatePlan, ask } from '../gemini.js';
import { DEFAULT_MODEL } from '../config.js';
import {
  nanoAvailability,
  createNanoSession,
  nanoPlan,
  nanoAsk,
  translate,
  translatePlan,
  warmTranslator,
  browserAI,
} from './nano.js';

/** @typedef {'cloud'|'nano'|'none'} ProviderKind */

/** Human-readable label for each backend. */
export const PROVIDER_LABELS = Object.freeze({
  cloud: 'Gemini (cloud, your key)',
  nano: 'Gemini Nano (on this device, no key needed)',
  none: 'Built-in planner (add a Gemini key for AI)',
});

/**
 * Picks the best available backend.
 * @param {string} apiKey saved key, may be empty
 * @param {import('./nano.js').BuiltInAI} [ai]
 * @returns {Promise<ProviderKind>}
 */
export async function resolveProvider(apiKey, ai = browserAI()) {
  if (apiKey) {
    return 'cloud';
  }
  return (await nanoAvailability(ai)) === 'unavailable' ? 'none' : 'nano';
}

/**
 * Caches one Nano session per household context, so chat keeps its history
 * until the household changes.
 */
const nanoCache = { key: '', session: /** @type {import('./nano.js').NanoSession | null} */ (null) };

/**
 * @param {object} context
 * @param {(fraction: number) => void} [onProgress]
 * @param {import('./nano.js').BuiltInAI} [ai]
 */
async function nanoSessionFor(context, onProgress, ai) {
  const key = JSON.stringify(context);
  if (nanoCache.session && nanoCache.key === key) {
    return nanoCache.session;
  }
  nanoCache.session?.destroy?.();
  nanoCache.session = await createNanoSession({ context, onProgress, ai });
  nanoCache.key = key;
  return nanoCache.session;
}

/** Forgets the cached on-device session (used in tests). */
export function resetNanoCache() {
  nanoCache.session?.destroy?.();
  nanoCache.session = null;
  nanoCache.key = '';
}

/**
 * @typedef {object} RunOptions
 * @property {ProviderKind} provider
 * @property {string} apiKey
 * @property {string} model
 * @property {ReturnType<typeof import('../gemini.js').buildContext>} context
 * @property {string} lang
 * @property {(fraction: number) => void} [onProgress]
 * @property {import('./nano.js').BuiltInAI} [ai]
 * @property {typeof fetch} [fetchImpl]
 */

/**
 * Generates the day plan with the chosen backend. Rule-based health alerts are
 * attached, and translated with the rest of an on-device plan.
 * @param {RunOptions & {alerts?: import('../types.js').Plan['alerts']}} o
 * @returns {Promise<import('../types.js').Plan>}
 */
export async function planWith({ provider, apiKey, model, context, lang, onProgress, ai, fetchImpl, alerts = [] }) {
  if (provider === 'cloud') {
    const plan = await generatePlan({ apiKey, model: model || DEFAULT_MODEL, context, lang, fetchImpl });
    return { ...plan, alerts, source: 'gemini', lang };
  }
  if (provider === 'nano') {
    warmTranslator(lang, ai); // start language-pack download while the click still counts
    const session = await nanoSessionFor(context, onProgress, ai);
    return translatePlan({ ...(await nanoPlan(session, context)), alerts }, lang, ai);
  }
  throw new Error('No AI backend available.');
}

/**
 * Answers a chat question with the chosen backend.
 * @param {RunOptions & {history: import('../types.js').ChatTurn[], question: string}} o
 * @returns {Promise<string>}
 */
export async function askWith({
  provider,
  apiKey,
  model,
  context,
  lang,
  history,
  question,
  onProgress,
  ai,
  fetchImpl,
}) {
  if (provider === 'cloud') {
    return ask({ apiKey, model: model || DEFAULT_MODEL, context, lang, history, question, fetchImpl });
  }
  if (provider === 'nano') {
    warmTranslator(lang, ai);
    const session = await nanoSessionFor(context, onProgress, ai);
    return translate(await nanoAsk(session, question), lang, ai);
  }
  throw new Error('No AI backend available.');
}
