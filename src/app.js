/**
 * SaansSaathi controller: owns the state, runs the model, and tells the view
 * modules when to render. Views live in `src/ui/`; the model has no DOM code.
 * @module app
 */
import { byId, debounce, inputById, errorMessage } from './dom.js';
import { fetchAirQuality } from './api.js';
import { buildEnvironment, parseOpenMeteo } from './environment.js';
import { householdDose } from './exposure.js';
import { rankSwaps } from './swaps.js';
import { buildOfflinePlan } from './engine.js';
import { loadState, saveState, demoState, newMember, loadPrefs, saveForecast, loadForecast } from './store.js';
import { placeLabel } from './format.js';
import { MAX_MEMBERS, PERSIST_DEBOUNCE_MS, RECOMPUTE_DEBOUNCE_MS } from './config.js';
import { initPlaceSearch, renderAir, showAirError, showAirLoading } from './ui/air-view.js';
import { renderHome, renderMembers } from './ui/household-view.js';
import { renderBudget, renderSwaps, renderPlan, renderGuidance } from './ui/results-view.js';
import { initAssistant, openSettings, renderSuggestions } from './ui/assistant-view.js';
import { initShare } from './ui/share.js';

/** Number of top swaps pre-selected for the combined total. */
const DEFAULT_SELECTED_SWAPS = 3;

/** @type {import('./types.js').AppState} */
const app = {
  state: loadState(),
  prefs: loadPrefs(),
  env: null,
  swaps: [],
  selected: new Set(),
  chat: [],
  aiPlan: null,
  lastPlan: null,
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
  app.lastPlan = app.aiPlan ?? offline;
  renderPlan(app.lastPlan);
  renderGuidance(offline);
  renderSuggestions(ctx);
}

/**
 * Builds the environment from a raw forecast and refreshes the screen.
 * @param {any} json Open-Meteo response
 * @param {string} [note] shown under the reading, e.g. for offline data
 */
function applyForecast(json, note) {
  app.env = buildEnvironment(parseOpenMeteo(json), new Date());
  renderAir(app.env, app.state.place, json.current, note);
  recompute();
}

/** Fetches the forecast for the current place, falling back to the last saved one. */
async function loadAir() {
  const place = app.state.place;
  showAirLoading(placeLabel(place));
  try {
    const json = await fetchAirQuality(place.latitude, place.longitude);
    saveForecast(place, json);
    applyForecast(json);
  } catch (e) {
    const saved = loadForecast(place);
    if (saved) {
      const time = new Date(saved.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
      applyForecast(saved.json, `Offline: showing the forecast saved at ${time}.`);
    } else {
      showAirError(errorMessage(e), loadAir);
    }
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
  byId('members').lastElementChild?.querySelector('input')?.focus();
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
  inputById('place-input').value = placeLabel(demo.place);
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
  initShare(ctx);
  loadAir();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
