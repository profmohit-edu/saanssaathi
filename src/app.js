/**
 * SaansSaathi controller: owns the state, runs the model, and tells the view
 * modules when to render. Views live in `src/ui/`; the model has no DOM code.
 * @module app
 */
import { byId, debounce } from './dom.js';
import { fetchAirQuality } from './api.js';
import { buildEnvironment, parseOpenMeteo } from './environment.js';
import { householdDose } from './exposure.js';
import { rankSwaps } from './swaps.js';
import { buildOfflinePlan } from './engine.js';
import { loadState, saveState, demoState, newMember, loadPrefs } from './store.js';
import { placeLabel } from './format.js';
import { MAX_MEMBERS, PERSIST_DEBOUNCE_MS, RECOMPUTE_DEBOUNCE_MS } from './config.js';
import { initPlaceSearch, renderAir, showAirError, showAirLoading } from './ui/air-view.js';
import { renderHome, renderMembers } from './ui/household-view.js';
import { renderBudget, renderSwaps, renderPlan, renderGuidance } from './ui/results-view.js';
import { initAssistant, openSettings, renderSuggestions } from './ui/assistant-view.js';

/** Number of top swaps pre-selected for the combined total. */
const DEFAULT_SELECTED_SWAPS = 3;

/** @type {import('./types.js').AppState} */
const app = {
  state: /** @type {import('./types.js').AppState['state']} */ (loadState()),
  prefs: loadPrefs(),
  env: null,
  swaps: [],
  selected: new Set(),
  chat: [],
  aiPlan: null,
  busy: false,
};

/** Re-runs the exposure model and refreshes every result panel. */
function recompute() {
  if (!app.env) {
    return;
  }
  const dose = householdDose(app.state.members, app.state.home, app.env);
  app.swaps = rankSwaps(app.state, app.env);
  if (!app.selected.size) {
    app.swaps.slice(0, DEFAULT_SELECTED_SWAPS).forEach((s) => app.selected.add(s.id));
  }
  const offline = buildOfflinePlan(app.state, app.env, app.swaps);
  renderBudget(dose);
  renderSwaps(app);
  renderPlan(app.aiPlan ?? offline);
  renderGuidance(offline);
  renderSuggestions(ctx);
}

/** Fetches the forecast for the current place, then recomputes. */
async function loadAir() {
  showAirLoading(placeLabel(app.state.place));
  try {
    const json = await fetchAirQuality(app.state.place.latitude, app.state.place.longitude);
    app.env = buildEnvironment(parseOpenMeteo(json), new Date());
    renderAir(app.env, app.state.place, json.current);
    recompute();
  } catch (e) {
    showAirError(/** @type {Error} */ (e).message, loadAir);
  }
}

const persist = debounce(() => saveState(app.state), PERSIST_DEBOUNCE_MS);
const recomputeSoon = debounce(recompute, RECOMPUTE_DEBOUNCE_MS);

/** @type {import('./types.js').AppContext} */
const ctx = {
  app,
  actions: {
    changed(structural = true) {
      persist();
      if (structural) {
        app.aiPlan = null;
      } // an AI plan no longer matches edited inputs
      recomputeSoon();
    },
    recompute,
    persist,
    loadAir,
    renderMembers: () => renderMembers(ctx),
    openSettings: () => openSettings(app),
  },
};

/** Adds a household member and focuses their name field. */
function addMember() {
  if (app.state.members.length >= MAX_MEMBERS) {
    return;
  }
  app.state.members.push(newMember(`Person ${app.state.members.length + 1}`));
  renderMembers(ctx);
  ctx.actions.changed();
  /** @type {HTMLInputElement | null} */ (byId('members').lastElementChild?.querySelector('input') ?? null)?.focus();
}

/** Replaces the household with the demo family. */
function loadDemo() {
  const demo = demoState();
  const placeChanged = demo.place.name !== app.state.place.name;
  app.state = demo;
  app.selected.clear();
  app.aiPlan = null;
  renderHome(ctx);
  renderMembers(ctx);
  persist();
  /** @type {HTMLInputElement} */ (byId('place-input')).value = placeLabel(demo.place);
  if (placeChanged) {
    loadAir();
  } else {
    recompute();
  }
}

function init() {
  initAssistant(ctx);
  initPlaceSearch(ctx);
  renderHome(ctx);
  renderMembers(ctx);
  byId('add-member').addEventListener('click', addMember);
  byId('demo-btn').addEventListener('click', loadDemo);
  loadAir();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
