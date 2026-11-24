/**
 * Gemini features: personalised plan, grounded chat, suggested questions
 * and the settings dialog.
 * @module ui/assistant-view
 */
import { h, mount, byId, richText } from '../dom.js';
import { householdDose, AGE_GROUPS } from '../exposure.js';
import { buildOfflinePlan } from '../engine.js';
import { buildContext, generatePlan, ask, LANGUAGES } from '../gemini.js';
import { loadApiKey, saveApiKey, savePrefs } from '../store.js';
import { placeLabel } from '../format.js';
import { DEFAULT_MODEL, isValidModel } from '../config.js';
import { renderPlan } from './results-view.js';

/**
 * Grounding context for Gemini built from the current state.
 * @param {import('../types.js').AppState} app
 */
function contextFor(app) {
  const env = /** @type {import('../types.js').Environment} */ (app.env);
  const dose = householdDose(app.state.members, app.state.home, env);
  return buildContext({ place: placeLabel(app.state.place), env, state: app.state, dose, swaps: app.swaps });
}

/**
 * Returns the saved key, or opens Settings and returns null.
 * @param {import('../types.js').AppContext} ctx
 */
function requireKey({ actions }) {
  const key = loadApiKey();
  if (!key) {
    actions.openSettings();
  }
  return key || null;
}

/**
 * Asks Gemini for a structured plan and renders it.
 * @param {import('../types.js').AppContext} ctx
 */
async function onGeneratePlan(ctx) {
  const { app } = ctx;
  if (!app.env || app.busy) {
    return;
  }
  const key = requireKey(ctx);
  if (!key) {
    return;
  }
  const status = byId('plan-status');
  const btn = /** @type {HTMLButtonElement} */ (byId('gen-plan'));
  app.busy = true;
  btn.disabled = true;
  status.textContent = "Gemini is writing your family's plan…";
  try {
    const plan = await generatePlan({
      apiKey: key,
      model: app.prefs.model || DEFAULT_MODEL,
      context: contextFor(app),
      lang: app.prefs.lang,
    });
    const { alerts } = buildOfflinePlan(app.state, app.env, app.swaps);
    app.aiPlan = { ...plan, source: 'gemini', alerts, lang: app.prefs.lang };
    renderPlan(app.aiPlan);
    status.textContent = 'Plan ready.';
  } catch (e) {
    status.textContent = `${/** @type {Error} */ (e).message} Showing the built-in plan instead.`;
  } finally {
    app.busy = false;
    btn.disabled = false;
  }
}

/**
 * Appends a chat bubble.
 * @param {'user'|'model'} role
 * @param {string} text
 * @param {string} lang BCP-47 code for model replies
 */
function addBubble(role, text, lang) {
  const bubble = h(
    'div',
    { class: `bubble ${role}`, lang: role === 'model' ? lang : undefined },
    h('span', { class: 'sr-only' }, role === 'user' ? 'You said: ' : 'SaansSaathi said: '),
    role === 'model' ? richText(text) : h('p', {}, text),
  );
  byId('chat-log').append(bubble);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  bubble.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * Sends a question to Gemini, grounded in the household's numbers.
 * @param {import('../types.js').AppContext} ctx
 * @param {string} question
 */
async function onAsk(ctx, question) {
  const { app } = ctx;
  const q = question.trim();
  if (!q || !app.env || app.busy) {
    return;
  }
  const key = requireKey(ctx);
  if (!key) {
    return;
  }
  app.busy = true;
  addBubble('user', q, app.prefs.lang);
  const pending = h('div', { class: 'bubble model pending' }, 'Thinking…');
  byId('chat-log').append(pending);
  try {
    const answer = await ask({
      apiKey: key,
      model: app.prefs.model || DEFAULT_MODEL,
      context: contextFor(app),
      lang: app.prefs.lang,
      history: app.chat,
      question: q,
    });
    addBubble('model', answer, app.prefs.lang);
    app.chat.push({ role: 'user', text: q }, { role: 'model', text: answer });
  } catch (e) {
    addBubble('model', `Error: ${/** @type {Error} */ (e).message}`, 'en');
  } finally {
    pending.remove();
    app.busy = false;
  }
}

/**
 * Suggested questions, personalised with a sensitive member's name.
 * @param {import('../types.js').Member[]} members
 * @returns {string[]}
 */
export function suggestedQuestions(members) {
  const first =
    members.find((m) => AGE_GROUPS[/** @type {keyof typeof AGE_GROUPS} */ (m.age)]?.sensitive)?.name ??
    members[0]?.name ??
    'my family';
  return [
    `Is it safe for ${first} to go outside tomorrow?`,
    "Explain our biggest exposure source like I'm 10.",
    'Plan a smog-safe Diwali or wedding evening for us.',
    'How do I get my housing society to stop garbage burning?',
  ];
}

/**
 * Renders the suggestion chips.
 * @param {import('../types.js').AppContext} ctx
 */
export function renderSuggestions(ctx) {
  mount(
    byId('suggestions'),
    suggestedQuestions(ctx.app.state.members).map((q) => {
      const b = h('button', { type: 'button', class: 'chip-btn' }, q);
      b.addEventListener('click', () => onAsk(ctx, q));
      return b;
    }),
  );
}

/**
 * Opens the Gemini settings dialog pre-filled with current values.
 * @param {import('../types.js').AppState} app
 */
export function openSettings(app) {
  /** @type {HTMLInputElement} */ (byId('api-key')).value = loadApiKey();
  /** @type {HTMLInputElement} */ (byId('model')).value = app.prefs.model;
  /** @type {HTMLDialogElement} */ (byId('settings')).showModal();
}

/**
 * Wires the plan button, chat form, language picker and settings dialog.
 * @param {import('../types.js').AppContext} ctx
 */
export function initAssistant(ctx) {
  const { app } = ctx;
  byId('gen-plan').addEventListener('click', () => onGeneratePlan(ctx));
  byId('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (byId('chat-input'));
    onAsk(ctx, input.value);
    input.value = '';
  });

  byId('open-settings').addEventListener('click', () => openSettings(app));
  const dlg = /** @type {HTMLDialogElement} */ (byId('settings'));
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') {
      return;
    }
    const key = /** @type {HTMLInputElement} */ (byId('api-key')).value;
    const remember = /** @type {HTMLInputElement} */ (byId('remember-key')).checked;
    const model = /** @type {HTMLInputElement} */ (byId('model')).value.trim();
    saveApiKey(key, remember);
    app.prefs.model = isValidModel(model) ? model : '';
    savePrefs(app.prefs);
    byId('plan-status').textContent = key.trim() ? 'Gemini key saved. AI features are on.' : 'Gemini key removed.';
  });

  const lang = /** @type {HTMLSelectElement} */ (byId('lang'));
  mount(
    lang,
    Object.entries(LANGUAGES).map(([k, v]) => h('option', { value: k, selected: k === app.prefs.lang }, v)),
  );
  lang.addEventListener('change', () => {
    app.prefs.lang = lang.value;
    savePrefs(app.prefs);
  });
}
