/**
 * "Air where you live": place search, live reading and the 24-hour chart.
 * @module ui/air-view
 */
import { h, mount, byId, debounce } from '../dom.js';
import { searchPlaces } from '../api.js';
import { bandForPm25, naqiFromPm25, WHO_24H_PM25 } from '../aqi.js';
import { formatRange } from '../windows.js';
import { renderChart, renderTable } from '../chart.js';
import { fmt, placeLabel, forecastSummary } from '../format.js';
import { CLEAN_WINDOW_HOURS, GEO_OPTIONS, SEARCH_DEBOUNCE_MS } from '../config.js';

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
 * Renders the current reading, key facts and chart.
 * @param {import('../types.js').Environment} env
 * @param {import('../types.js').Place} place
 * @param {{pm10?: number, nitrogen_dioxide?: number}} [current] raw current readings
 * @param {string} [note] status note, e.g. offline data
 */
export function renderAir(env, place, current = {}, note = '') {
  const band = bandForPm25(env.current);
  const best = env.bestFor(CLEAN_WINDOW_HOURS);
  const out = byId('air-now');
  mount(
    out,
    h(
      'div',
      { class: 'air-grid' },
      h(
        'div',
        { class: `aqi-badge band-${band.key}` },
        h('span', { class: 'aqi-num' }, fmt(env.current)),
        h('span', { class: 'aqi-unit' }, 'µg/m³ PM2.5 now'),
        h('span', { class: 'aqi-band' }, `${band.label} · NAQI ${naqiFromPm25(env.current)}`),
      ),
      h(
        'div',
        { class: 'air-facts' },
        h('p', { class: 'place' }, placeLabel(place)),
        note && h('p', { class: 'offline-note', role: 'status' }, note),
        h('p', {}, band.advice),
        h(
          'ul',
          { class: 'facts' },
          h('li', {}, h('strong', {}, `${fmt(env.current / WHO_24H_PM25, 1)}×`), ' the WHO 24-hour guideline'),
          h('li', {}, 'Next 24 h average: ', h('strong', {}, `${fmt(env.dailyMean)} µg/m³`)),
          env.peak &&
            h(
              'li',
              {},
              'Worst stretch: ',
              h('strong', {}, formatRange(env.peak.start, env.peak.end)),
              ` (${fmt(env.peak.mean)} µg/m³)`,
            ),
          best &&
            h(
              'li',
              { class: 'good' },
              `Cleanest ${CLEAN_WINDOW_HOURS} hours: `,
              h('strong', {}, formatRange(best.start, best.end)),
              ` (${fmt(best.mean)} µg/m³)`,
            ),
          Number.isFinite(current.pm10) &&
            h('li', {}, `PM10 ${fmt(Number(current.pm10))} · NO₂ ${fmt(current.nitrogen_dioxide ?? 0)} µg/m³`),
        ),
      ),
    ),
  );
  out.setAttribute('aria-busy', 'false');
  renderChart(byId('chart'), env.hours, best);
  mount(byId('chart-table'), renderTable(env.hours));
  byId('chart-summary').textContent = forecastSummary(env.hours, best ? formatRange(best.start, best.end) : '');
}

/**
 * Wires the place search box, results list and geolocation button.
 * @param {import('../types.js').AppContext} ctx
 */
export function initPlaceSearch({ app, actions }) {
  const form = byId('place-form');
  const input = /** @type {HTMLInputElement} */ (byId('place-input'));
  const list = byId('place-results');
  input.value = placeLabel(app.state.place);

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  /** @param {import('../types.js').Place} place */
  const choose = (place) => {
    app.state.place = {
      name: place.name,
      admin1: place.admin1 ?? '',
      country: place.country ?? '',
      latitude: place.latitude,
      longitude: place.longitude,
    };
    input.value = placeLabel(app.state.place);
    close();
    actions.persist();
    actions.loadAir();
    input.focus();
  };

  /** @param {import('../types.js').Place} place @param {number} i */
  const option = (place, i) => {
    const li = h('li', { role: 'option', id: `place-opt-${i}`, tabindex: '-1' }, placeLabel(place));
    li.addEventListener('click', () => choose(place));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(place);
      }
      if (e.key === 'ArrowDown') {
        const next = /** @type {HTMLElement | null} */ (li.nextElementSibling);
        next?.focus();
      }
      if (e.key === 'ArrowUp') {
        const prev = /** @type {HTMLElement | null} */ (li.previousElementSibling);
        (prev ?? input).focus();
      }
      if (e.key === 'Escape') {
        close();
        input.focus();
      }
    });
    return li;
  };

  /** @param {import('../types.js').Place[]} results */
  const show = (results) => {
    mount(list, results.length ? results.map(option) : h('li', { class: 'empty' }, 'No matching places'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const run = async () => {
    try {
      show(await searchPlaces(input.value));
    } catch (e) {
      mount(list, h('li', { class: 'empty' }, /** @type {Error} */ (e).message));
      list.hidden = false;
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  input.addEventListener(
    'input',
    debounce(() => {
      if (input.value.trim().length >= MIN_LIVE_QUERY) {
        run();
      }
    }, SEARCH_DEBOUNCE_MS),
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !list.hidden) {
      e.preventDefault();
      /** @type {HTMLElement | null} */ (list.firstElementChild)?.focus();
    }
  });

  byId('geo-btn').addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: 'My location', latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () =>
        mount(
          byId('air-now'),
          h('p', { class: 'error', role: 'alert' }, 'Location permission was denied. Search for your city instead.'),
        ),
      GEO_OPTIONS,
    );
  });
}
