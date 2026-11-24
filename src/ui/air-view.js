/**
 * "Air where you live": place search, live reading and the 24-hour chart.
 * @module ui/air-view
 */
import { h, mount, byId, debounce, inputById, errorMessage } from '../dom.js';
import { searchPlaces } from '../api.js';
import { bandForPm25, naqiFromPm25, WHO_24H_PM25 } from '../aqi.js';
import { formatRange } from '../windows.js';
import { renderChart, renderTable } from '../chart.js';
import { fmt, placeLabel, forecastSummary } from '../format.js';
import { CLEAN_WINDOW_HOURS, GEO_OPTIONS, SEARCH_DEBOUNCE_MS } from '../config.js';

/**
 * Moves focus to an element if there is one.
 * @param {Element | null} el
 */
function focusIfElement(el) {
  if (el instanceof HTMLElement) {
    el.focus();
  }
}

/** Minimum characters before searching as the user types. */
const MIN_LIVE_QUERY = 3;

/**
 * Shows a loading state for the air card.
 * @param {string} label place label
 */
export function showAirLoading(label) {
  const out = byId('air-now');
  out.setAttribute('aria-busy', 'true');
  mount(out, h('p', { class: 'loading' }, `Loading the forecast for ${label}…`));
}

/**
 * Shows an error with a retry button.
 * @param {string} message
 * @param {() => void} onRetry
 */
export function showAirError(message, onRetry) {
  const retry = h('button', { type: 'button', class: 'btn' }, 'Retry');
  retry.addEventListener('click', onRetry);
  const out = byId('air-now');
  mount(out, h('p', { class: 'error', role: 'alert' }, `Couldn't load air quality: ${message}`), retry);
  out.setAttribute('aria-busy', 'false');
}

/**
 * The coloured badge with the current PM2.5 and NAQI band.
 * @param {number} pm25
 */
function aqiBadge(pm25) {
  const band = bandForPm25(pm25);
  return h(
    'div',
    { class: `aqi-badge band-${band.key}` },
    h('span', { class: 'aqi-num' }, fmt(pm25)),
    h('span', { class: 'aqi-unit' }, 'µg/m³ PM2.5 now'),
    h('span', { class: 'aqi-band' }, `${band.label} · NAQI ${naqiFromPm25(pm25)}`),
  );
}

/**
 * A fact line such as "Worst stretch: 7 am – 10 am (124 µg/m³)".
 * @param {string} label
 * @param {{start: Date, end: Date, mean: number}} window
 * @param {string} [cls]
 */
function windowFact(label, window, cls = '') {
  return h(
    'li',
    cls ? { class: cls } : {},
    label,
    h('strong', {}, formatRange(window.start, window.end)),
    ` (${fmt(window.mean)} µg/m³)`,
  );
}

/**
 * Bullet list of key facts about the next 24 hours.
 * @param {import('../types.js').Environment} env
 * @param {{start: Date, end: Date, mean: number} | null} best
 * @param {{pm10?: number, nitrogen_dioxide?: number}} current
 */
function factsList(env, best, current) {
  return h(
    'ul',
    { class: 'facts' },
    h('li', {}, h('strong', {}, `${fmt(env.current / WHO_24H_PM25, 1)}×`), ' the WHO 24-hour guideline'),
    h('li', {}, 'Next 24 h average: ', h('strong', {}, `${fmt(env.dailyMean)} µg/m³`)),
    env.peak && windowFact('Worst stretch: ', env.peak),
    best && windowFact(`Cleanest ${CLEAN_WINDOW_HOURS} hours: `, best, 'good'),
    Number.isFinite(current.pm10) &&
      h('li', {}, `PM10 ${fmt(Number(current.pm10))} · NO₂ ${fmt(current.nitrogen_dioxide ?? 0)} µg/m³`),
  );
}

/**
 * Renders the current reading, key facts and chart.
 * @param {import('../types.js').Environment} env
 * @param {import('../types.js').Place} place
 * @param {{pm10?: number, nitrogen_dioxide?: number}} [current] raw current readings
 * @param {string} [note] status note, e.g. offline data
 */
export function renderAir(env, place, current = {}, note = '') {
  const best = env.bestFor(CLEAN_WINDOW_HOURS);
  const out = byId('air-now');
  const facts = h(
    'div',
    { class: 'air-facts' },
    h('p', { class: 'place' }, placeLabel(place)),
    note && h('p', { class: 'offline-note', role: 'status' }, note),
    h('p', {}, bandForPm25(env.current).advice),
    factsList(env, best, current),
  );
  mount(out, h('div', { class: 'air-grid' }, aqiBadge(env.current), facts));
  out.setAttribute('aria-busy', 'false');
  renderChart(byId('chart'), env.hours, best);
  mount(byId('chart-table'), renderTable(env.hours));
  byId('chart-summary').textContent = forecastSummary(env.hours, best ? formatRange(best.start, best.end) : '');
}

/**
 * Keyboard handling for one option in the place results list.
 * @param {KeyboardEvent} e
 * @param {HTMLElement} li
 * @param {{ pick: () => void, close: () => void, input: HTMLInputElement }} ui
 */
function onOptionKey(e, li, { pick, close, input }) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pick();
  } else if (e.key === 'ArrowDown') {
    focusIfElement(li.nextElementSibling);
  } else if (e.key === 'ArrowUp') {
    focusIfElement(li.previousElementSibling ?? input);
  } else if (e.key === 'Escape') {
    close();
    input.focus();
  }
}

/**
 * Wires the "use my location" button.
 * @param {(place: import('../types.js').Place) => void} choose
 */
function initGeolocation(choose) {
  const showError = (/** @type {string} */ text) =>
    mount(byId('air-now'), h('p', { class: 'error', role: 'alert' }, text));
  byId('geo-btn').addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      showError('This browser cannot share your location. Search for your city instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: 'My location', latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => showError('Location permission was denied. Search for your city instead.'),
      GEO_OPTIONS,
    );
  });
}

/**
 * Wires the search triggers: form submit, live typing and ArrowDown into the list.
 * @param {HTMLElement} form
 * @param {HTMLInputElement} input
 * @param {HTMLElement} list
 * @param {() => void} run
 */
function wireSearchTriggers(form, input, list, run) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  const liveSearch = () => {
    if (input.value.trim().length >= MIN_LIVE_QUERY) {
      run();
    }
  };
  input.addEventListener('input', debounce(liveSearch, SEARCH_DEBOUNCE_MS));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !list.hidden) {
      e.preventDefault();
      focusIfElement(list.firstElementChild);
    }
  });
}

/**
 * Wires the place search box, results list and geolocation button.
 * @param {import('../types.js').AppContext} ctx
 */
export function initPlaceSearch({ app, actions }) {
  const form = byId('place-form');
  const input = inputById('place-input');
  const list = byId('place-results');
  input.value = placeLabel(app.state.place);

  /** @param {boolean} expanded */
  const setOpen = (expanded) => {
    list.hidden = !expanded;
    input.setAttribute('aria-expanded', String(expanded));
  };
  const close = () => setOpen(false);

  /** @param {import('../types.js').Place} place */
  const choose = (place) => {
    const { name, admin1 = '', country = '', latitude, longitude } = place;
    app.state.place = { name, admin1, country, latitude, longitude };
    input.value = placeLabel(app.state.place);
    close();
    actions.persist();
    actions.loadAir();
    input.focus();
  };

  /** @param {import('../types.js').Place} place @param {number} i */
  const option = (place, i) => {
    const li = h('li', { role: 'option', id: `place-opt-${i}`, tabindex: '-1' }, placeLabel(place));
    const pick = () => choose(place);
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => onOptionKey(e, li, { pick, close, input }));
    return li;
  };

  const run = async () => {
    try {
      const results = await searchPlaces(input.value);
      mount(list, results.length ? results.map(option) : h('li', { class: 'empty' }, 'No matching places'));
    } catch (e) {
      mount(list, h('li', { class: 'empty' }, errorMessage(e)));
    }
    setOpen(true);
  };

  wireSearchTriggers(form, input, list, run);
  initGeolocation(choose);
}
