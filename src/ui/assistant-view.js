/**
 * AI features: personalised plan, grounded chat, suggested questions, the
 * active-backend badge and the settings dialog.
 * @module ui/assistant-view
 */
import { h, mount, byId, richText, inputById, selectById, buttonById, dialogById, errorMessage } from '../dom.js';
import { householdDose, AGE_GROUPS, lookup } from '../exposure.js';
import { buildOfflinePlan } from '../engine.js';
import { buildContext, LANGUAGES } from '../gemini.js';
import { resolveProvider, planWith, askWith, PROVIDER_LABELS } from '../ai/provider.js';
import { warmTranslator } from '../ai/nano.js';
import { loadApiKey, saveApiKey, savePrefs } from '../store.js';
import { placeLabel } from '../format.js';
import { isValidModel } from '../config.js';
import { renderPlan } from './results-view.js';

/**
 * Grounding context for Gemini built from the current state.
 * @param {import('../types.js').AppState} app
 * @param {import('../types.js').Environment} env
 */
function contextFor(app, env) {
  const dose = householdDose(app.state.members, app.state.home, env);
  return buildContext({ place: placeLabel(app.state.place), env, state: app.state, dose, swaps: app.swaps });
}

/**
 * Picks the AI backend for this request. With no key and no on-device model,
 * opens Settings and returns null.
 * @param {import('../types.js').AppContext} ctx
 */
async function chooseBackend({ app, actions }) {
  const apiKey = loadApiKey();
  const provider = await resolveProvider(apiKey);
  if (provider === 'none') {
    actions.openSettings();
    return null;
  }
  return { provider, apiKey, model: app.prefs.model, lang: app.prefs.lang };
}

/**
 * Status updates while Chrome downloads Gemini Nano the first time.
 * @param {HTMLElement} status
 */
const progressTo = (status) => (/** @type {number} */ fraction) => {
  status.textContent =
    fraction >= 1
      ? 'Gemini Nano is ready. Writing your plan on this device…'
      : `Downloading Gemini Nano to this device… ${Math.round(fraction * 100)}% (one time only)`;
};

/**
 * Chrome only allows on-device language-pack downloads during a click, so
 * start the translator before any await when the on-device path may be used.
 * @param {import('../types.js').AppState} app
 */
function warmOnClick(app) {
  if (!loadApiKey()) {
    warmTranslator(app.prefs.lang);
  }
}

/**
 * Generates the personalised plan with the best available AI and renders it.
 * @param {import('../types.js').AppContext} ctx
 */
async function onGeneratePlan(ctx) {
  const { app } = ctx;
  if (!app.env || app.busy) {
    return;
  }
  warmOnClick(app);
  const backend = await chooseBackend(ctx);
  if (!backend) {
    return;
  }
  const status = byId('plan-status');
  const btn = buttonById('gen-plan');
  app.busy = true;
  btn.disabled = true;
  status.textContent = `${PROVIDER_LABELS[backend.provider]} is writing your family's plan…`;
  try {
    const plan = await planWith({ ...backend, context: contextFor(app, app.env), onProgress: progressTo(status) });
    const { alerts } = buildOfflinePlan(app.state, app.env, app.swaps);
    app.aiPlan = { ...plan, alerts };
    renderPlan(app.aiPlan);
    const untranslated = backend.lang !== 'en' && plan.lang === 'en';
    status.textContent = `Plan ready, written by ${PROVIDER_LABELS[backend.provider]}.${
      untranslated ? ' This language is not available on this device yet, so the plan is in English.' : ''
    }`;
  } catch (e) {
    status.textContent = `${errorMessage(e)} Showing the built-in plan instead.`;
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
 * Answers a question with the best available AI, grounded in the household's numbers.
 * @param {import('../types.js').AppContext} ctx
 * @param {string} question
 */
async function onAsk(ctx, question) {
  const { app } = ctx;
  const q = question.trim();
  if (!q || !app.env || app.busy) {
    return;
  }
  warmOnClick(app);
  const backend = await chooseBackend(ctx);
  if (!backend) {
    return;
  }
  app.busy = true;
  addBubble('user', q, app.prefs.lang);
  const pending = h('div', { class: 'bubble model pending' }, 'Thinking…');
  byId('chat-log').append(pending);
  try {
    const answer = await askWith({
      ...backend,
      context: contextFor(app, app.env),
      history: app.chat,
      question: q,
      onProgress: (f) => {
        pending.textContent = `Downloading Gemini Nano… ${Math.round(f * 100)}%`;
      },
    });
    addBubble('model', answer, app.prefs.lang);
    app.chat.push({ role: 'user', text: q }, { role: 'model', text: answer });
  } catch (e) {
    addBubble('model', `Error: ${errorMessage(e)}`, 'en');
  } finally {
    pending.remove();
    app.busy = false;
  }
}

/**
 * Shows which AI backend is active next to the plan button.
 * @returns {Promise<void>}
 */
export async function renderAiMode() {
  const provider = await resolveProvider(loadApiKey());
  const badge = byId('ai-mode');
  badge.textContent = `AI: ${PROVIDER_LABELS[provider]}`;
  badge.dataset.provider = provider;
}

/**
 * Suggested questions, personalised with a sensitive member's name.
 * @param {import('../types.js').Member[]} members
 * @returns {string[]}
 */
export function suggestedQuestions(members) {
  const first = members.find((m) => lookup(AGE_GROUPS, m.age)?.sensitive)?.name ?? members[0]?.name ?? 'my family';
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
  inputById('api-key').value = loadApiKey();
  inputById('model').value = app.prefs.model;
  dialogById('settings').showModal();
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
    const input = inputById('chat-input');
    onAsk(ctx, input.value);
    input.value = '';
  });

  byId('open-settings').addEventListener('click', () => openSettings(app));
  const dlg = dialogById('settings');
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') {
      return;
    }
    const key = inputById('api-key').value;
    const remember = inputById('remember-key').checked;
    const model = inputById('model').value.trim();
    saveApiKey(key, remember);
    app.prefs.model = isValidModel(model) ? model : '';
    savePrefs(app.prefs);
    byId('plan-status').textContent = key.trim() ? 'Gemini key saved. Cloud AI is on.' : 'Gemini key removed.';
    renderAiMode();
  });

  const lang = selectById('lang');
  mount(
    lang,
    Object.entries(LANGUAGES).map(([k, v]) => h('option', { value: k, selected: k === app.prefs.lang }, v)),
  );
  lang.addEventListener('change', () => {
    app.prefs.lang = lang.value;
    savePrefs(app.prefs);
  });
  renderAiMode();
}
