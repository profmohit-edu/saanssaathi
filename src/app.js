/**
 * SaansSaathi: UI controller. Wires state → model → view.
 * @module app
 */
import { h, mount, richText, debounce } from './dom.js';
import { searchPlaces, fetchAirQuality } from './api.js';
import { buildEnvironment, parseOpenMeteo, OUTDOOR_SLOTS } from './environment.js';
import { bandForPm25, naqiFromPm25, WHO_24H_PM25 } from './aqi.js';
import { householdDose, AGE_GROUPS, COMMUTE_MODES, MASKS, OUTDOOR_ACTIVITY, INDOOR_SOURCES } from './exposure.js';
import { rankSwaps, combine } from './swaps.js';
import { buildOfflinePlan, MYTHS } from './engine.js';
import { formatRange } from './windows.js';
import { renderChart, renderTable } from './chart.js';
import { buildContext, generatePlan, ask, LANGUAGES, DEFAULT_MODEL } from './gemini.js';
import {
  loadState, saveState, demoState, newMember, CONDITIONS,
  loadPrefs, savePrefs, loadApiKey, saveApiKey,
} from './store.js';

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

const app = {
  state: loadState(),
  prefs: loadPrefs(),
  env: null,
  swaps: [],
  selected: new Set(),
  chat: /** @type {Array<{role:'user'|'model', text:string}>} */ ([]),
  aiPlan: null,
  busy: false,
};

const fmt = (n, d = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const placeLabel = (p) => [p.name, p.admin1, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');

/* ---------------- Air ---------------- */

async function loadAir() {
  const out = $('#air-now');
  out.setAttribute('aria-busy', 'true');
  mount(out, h('p', { class: 'loading' }, `Loading the forecast for ${placeLabel(app.state.place)}…`));
  try {
    const json = await fetchAirQuality(app.state.place.latitude, app.state.place.longitude);
    app.env = buildEnvironment(parseOpenMeteo(json), new Date());
    renderAir(json);
    recompute();
  } catch (e) {
    mount(out, h('p', { class: 'error', role: 'alert' }, `Couldn't load air quality: ${e.message}`),
      retryButton());
  } finally {
    out.setAttribute('aria-busy', 'false');
  }
}

function retryButton() {
  const b = h('button', { type: 'button', class: 'btn' }, 'Retry');
  b.addEventListener('click', loadAir);
  return b;
}

function renderAir(json) {
  const env = app.env;
  const band = bandForPm25(env.current);
  const naqi = naqiFromPm25(env.current);
  const best = env.bestFor(2);
  const cur = json.current ?? {};
  mount($('#air-now'),
    h('div', { class: 'air-grid' },
      h('div', { class: `aqi-badge band-${band.key}` },
        h('span', { class: 'aqi-num' }, fmt(env.current)),
        h('span', { class: 'aqi-unit' }, 'µg/m³ PM2.5 now'),
        h('span', { class: 'aqi-band' }, `${band.label} · NAQI ${naqi}`)),
      h('div', { class: 'air-facts' },
        h('p', { class: 'place' }, placeLabel(app.state.place)),
        h('p', {}, band.advice),
        h('ul', { class: 'facts' },
          h('li', {}, h('strong', {}, `${fmt(env.current / WHO_24H_PM25, 1)}×`), ' the WHO 24-hour guideline'),
          h('li', {}, 'Next 24 h average: ', h('strong', {}, `${fmt(env.dailyMean)} µg/m³`)),
          env.peak && h('li', {}, 'Worst stretch: ', h('strong', {}, formatRange(env.peak.start, env.peak.end)),
            ` (${fmt(env.peak.mean)} µg/m³)`),
          best && h('li', { class: 'good' }, 'Cleanest 2 hours: ', h('strong', {}, formatRange(best.start, best.end)),
            ` (${fmt(best.mean)} µg/m³)`),
          Number.isFinite(cur.pm10) && h('li', {}, `PM10 ${fmt(cur.pm10)} · NO₂ ${fmt(cur.nitrogen_dioxide ?? 0)} µg/m³`)))));
  renderChart($('#chart'), env.hours, best);
  mount($('#chart-table'), renderTable(env.hours));
  $('#chart-summary').textContent = `PM2.5 ranges from ${fmt(Math.min(...env.hours.map((p) => p.pm25)))} to ${fmt(Math.max(...env.hours.map((p) => p.pm25)))} µg/m³ over the next day.${best ? ` Cleanest window ${formatRange(best.start, best.end)}.` : ''}`;
}

function initPlaceSearch() {
  const form = $('#place-form');
  const input = /** @type {HTMLInputElement} */ ($('#place-input'));
  const list = $('#place-results');
  input.value = placeLabel(app.state.place);

  const show = (results) => {
    mount(list, results.length
      ? results.map((r, i) => {
        const li = h('li', { role: 'option', id: `place-opt-${i}`, tabindex: '-1' }, placeLabel(r));
        li.addEventListener('click', () => choose(r));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(r); }
          if (e.key === 'ArrowDown') /** @type {HTMLElement} */ (li.nextElementSibling)?.focus();
          if (e.key === 'ArrowUp') (/** @type {HTMLElement} */ (li.previousElementSibling) ?? input).focus();
          if (e.key === 'Escape') { list.hidden = true; input.focus(); }
        });
        return li;
      })
      : h('li', { class: 'empty' }, 'No matching places'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const choose = (r) => {
    app.state.place = { name: r.name, admin1: r.admin1 ?? '', country: r.country ?? '', latitude: r.latitude, longitude: r.longitude };
    input.value = placeLabel(app.state.place);
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    persist();
    loadAir();
    input.focus();
  };
  const run = async () => {
    try { show(await searchPlaces(input.value)); } catch (e) { mount(list, h('li', { class: 'empty' }, e.message)); list.hidden = false; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  input.addEventListener('input', debounce(() => { if (input.value.trim().length >= 3) run(); }, 350));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); /** @type {HTMLElement} */ (list.firstElementChild)?.focus(); }
  });

  $('#geo-btn').addEventListener('click', () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: 'My location', latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => mount($('#air-now'), h('p', { class: 'error', role: 'alert' }, 'Location permission was denied. Search for your city instead.')),
      { maximumAge: 600000, timeout: 10000 },
    );
  });
}

/* ---------------- Household forms ---------------- */

function selectField(label, value, options, onChange, id) {
  const sel = h('select', { id }, Object.entries(options).map(([k, v]) =>
    h('option', { value: k, selected: k === value }, typeof v === 'string' ? v : v.label)));
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, h('label', { for: id }, label), sel);
}

function numberField(label, value, onChange, id, { min = 0, max = 12, step = 0.5 } = {}) {
  const inp = h('input', { id, type: 'number', inputmode: 'decimal', min, max, step, value });
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    if (Number.isFinite(n) && n >= min && n <= max) { inp.removeAttribute('aria-invalid'); onChange(n); }
    else inp.setAttribute('aria-invalid', 'true');
  });
  return h('div', { class: 'field' }, h('label', { for: id }, label), inp);
}

function renderHome() {
  const home = app.state.home;
  const windows = selectField('Windows during the day', home.windows, { open: 'Mostly open', closed: 'Mostly closed' },
    (v) => { home.windows = v; changed(); }, 'home-windows');
  const purifier = h('input', { type: 'checkbox', id: 'home-purifier', checked: home.purifier });
  purifier.addEventListener('change', () => { home.purifier = purifier.checked; changed(); });
  const sources = h('fieldset', { class: 'chips' }, h('legend', {}, 'Things burned or used at home'),
    Object.entries(INDOOR_SOURCES).map(([k, s]) => {
      const cb = h('input', { type: 'checkbox', id: `src-${k}`, checked: home.sources.includes(k) });
      cb.addEventListener('change', () => {
        home.sources = cb.checked ? [...new Set([...home.sources, k])] : home.sources.filter((x) => x !== k);
        changed();
      });
      return h('label', { class: 'chip', for: `src-${k}` }, cb, s.label);
    }));
  mount($('#home-grid'), windows,
    h('div', { class: 'field' }, h('label', { class: 'check', for: 'home-purifier' }, purifier, 'Air purifier or DIY filter')),
    sources);
}

function renderMembers() {
  const wrap = $('#members');
  mount(wrap, app.state.members.map((m, idx) => {
    const id = (s) => `${m.id}-${s}`;
    const summaryName = h('strong', {}, m.name);
    const summaryMeta = h('span', { class: 'summary-meta' }, memberSummary(m));
    const nameInput = h('input', { id: id('name'), type: 'text', maxlength: 30, value: m.name, autocomplete: 'off' });
    nameInput.addEventListener('input', () => {
      m.name = nameInput.value.slice(0, 30) || `Person ${idx + 1}`;
      summaryName.textContent = m.name;
      changed(false);
    });
    const remove = h('button', { type: 'button', class: 'btn ghost small', 'aria-label': `Remove ${m.name}` }, 'Remove');
    remove.addEventListener('click', () => {
      app.state.members = app.state.members.filter((x) => x.id !== m.id);
      renderMembers();
      changed();
      $('#add-member').focus();
    });
    const conds = h('fieldset', { class: 'chips' }, h('legend', {}, 'Health'),
      Object.entries(CONDITIONS).map(([k, label]) => {
        const cb = h('input', { type: 'checkbox', id: id(`c-${k}`), checked: m.conditions.includes(k) });
        cb.addEventListener('change', () => {
          m.conditions = cb.checked ? [...m.conditions, k] : m.conditions.filter((c) => c !== k);
          changed();
        });
        return h('label', { class: 'chip', for: id(`c-${k}`) }, cb, label);
      }));
    const card = h('details', { class: 'member', open: idx === 0 || app.state.members.length === 1 },
      h('summary', {}, summaryName, summaryMeta),
      h('div', { class: 'member-head' },
        h('div', { class: 'field grow' }, h('label', { for: id('name') }, 'Name'), nameInput),
        app.state.members.length > 1 && remove),
      h('div', { class: 'member-grid' },
        selectField('Age group', m.age, AGE_GROUPS, (v) => { m.age = v; changed(); }, id('age')),
        selectField('Commute', m.commuteMode, COMMUTE_MODES, (v) => { m.commuteMode = v; changed(); }, id('commute')),
        numberField('Commute hours / day', m.commuteHours, (v) => { m.commuteHours = v; changed(); }, id('ch'), { max: 6 }),
        numberField('Outdoor hours / day', m.outdoorHours, (v) => { m.outdoorHours = v; changed(); }, id('oh')),
        selectField('Usually outside', m.outdoorTime, OUTDOOR_SLOTS, (v) => { m.outdoorTime = v; changed(); }, id('ot')),
        selectField('Outdoor activity', m.outdoorActivity, OUTDOOR_ACTIVITY, (v) => { m.outdoorActivity = v; changed(); }, id('oa')),
        selectField('Mask', m.mask, MASKS, (v) => { m.mask = v; changed(); }, id('mask'))),
      conds);
    card.addEventListener('change', () => { summaryMeta.textContent = memberSummary(m); });
    return card;
  }));
}

/** One-line description of a member for the collapsed card. */
function memberSummary(m) {
  const parts = [AGE_GROUPS[m.age]?.label, COMMUTE_MODES[m.commuteMode]?.label,
    `${m.outdoorHours} h outdoors`, MASKS[m.mask]?.label, ...m.conditions.map((c) => CONDITIONS[c])];
  return parts.filter(Boolean).join(' · ');
}

/* ---------------- Results ---------------- */

const PART_LABELS = { sleep: 'Sleep', indoors: 'Indoors', commute: 'Commute', outdoors: 'Outdoors' };

function renderBudget(dose) {
  const max = Math.max(...dose.perMember.map((d) => d.total), 1);
  mount($('#budget-out'),
    h('p', { class: 'budget-headline' },
      'Together your household inhales about ', h('strong', {}, `${fmt(dose.total)} µg`),
      ' of PM2.5 a day, the same as smoking ', h('strong', {}, `${fmt(dose.cigarettes, 1)} cigarettes`), '.'),
    h('ul', { class: 'budget-list' }, dose.perMember.map((d) => h('li', { class: 'budget-row' },
      h('div', { class: 'budget-meta' },
        h('span', { class: 'who' }, d.name),
        h('span', { class: 'num' }, `${fmt(d.total)} µg`),
        h('span', { class: 'cig', title: 'Cigarette equivalent' }, `${fmt(d.cigarettes, 1)} cig. eq.`),
        h('span', { class: `who-x ${d.whoMultiple > 1 ? 'over' : 'ok'}` }, `${fmt(d.whoMultiple, 1)}× WHO`)),
      h('div', { class: 'stack', role: 'img',
        'aria-label': `${d.name}: ` + Object.entries(d.parts).map(([k, v]) => `${PART_LABELS[k]} ${fmt(v)} µg`).join(', ') },
      Object.entries(d.parts).filter(([, v]) => v > 0).map(([k, v]) => {
        const seg = h('span', { class: `seg seg-${k}`, title: `${PART_LABELS[k]}: ${fmt(v)} µg` });
        seg.style.width = `${(v / max) * 100}%`;
        return seg;
      }))))),
    h('ul', { class: 'legend', 'aria-hidden': 'true' },
      Object.entries(PART_LABELS).map(([k, l]) => h('li', {}, h('span', { class: `dot seg-${k}` }), l))));
}

function renderSwaps() {
  const list = $('#swap-list');
  if (!app.swaps.length) {
    mount(list, h('li', { class: 'empty' }, 'Your household is already doing everything SaansSaathi would suggest.'));
    renderSwapTotal();
    return;
  }
  mount(list, app.swaps.map((s, i) => {
    const cb = h('input', { type: 'checkbox', id: `swap-${s.id}`, checked: app.selected.has(s.id) });
    cb.addEventListener('change', () => {
      if (cb.checked) app.selected.add(s.id); else app.selected.delete(s.id);
      renderSwapTotal();
    });
    const top = s.perMember.filter((p) => p.pct >= 1).sort((a, b) => b.pct - a.pct).slice(0, 3);
    return h('li', { class: `swap cat-${s.category}` },
      h('div', { class: 'swap-check' }, cb),
      h('div', { class: 'swap-body' },
        h('label', { for: `swap-${s.id}`, class: 'swap-title' }, h('span', { class: 'rank' }, `#${i + 1}`), s.title),
        h('p', { class: 'swap-impact' },
          s.deltaUg > 0.5 && h('strong', {}, `−${fmt(s.pct)}% family dose`),
          s.deltaUg > 0.5 && ` · ≈ ${fmt(s.cigarettesPerWeek, 1)} cigarettes avoided / week`,
          s.co2KgPerWeek > 0.05 && ` · ${fmt(s.co2KgPerWeek, 1)} kg CO₂ less / week`),
        top.length > 0 && h('p', { class: 'swap-who' }, top.map((p) => `${p.name} −${fmt(p.pct)}%`).join(' · ')),
        h('p', { class: 'swap-why' }, s.why),
        h('p', { class: 'swap-cost' }, h('span', { class: 'tag' }, s.category), ' ', s.cost)));
  }));
  renderSwapTotal();
}

function renderSwapTotal() {
  const out = $('#swap-total');
  if (!app.env) return;
  const ids = [...app.selected].filter((id) => app.swaps.some((s) => s.id === id));
  if (!ids.length) {
    mount(out, h('p', {}, 'Tick one or more swaps to see the combined effect.'));
    return;
  }
  const c = combine(app.state, app.env, ids);
  const weekly = ((c.before.total - c.after.total) / (22 * 15)) * 7;
  const co2 = app.swaps.filter((s) => ids.includes(s.id)).reduce((a, s) => a + s.co2KgPerWeek, 0);
  mount(out,
    h('div', { class: 'meter', role: 'img', 'aria-label': `Dose falls by ${fmt(c.pct)} percent` },
      h('span', { class: 'meter-fill' })),
    h('p', { class: 'swap-total-text' },
      'With these ', h('strong', {}, String(ids.length)), ' swaps your family\'s daily dose falls from ',
      h('strong', {}, `${fmt(c.before.total)} µg`), ' to ', h('strong', {}, `${fmt(c.after.total)} µg`),
      ` (−${fmt(c.pct)}%). That's about `, h('strong', {}, `${fmt(weekly, 1)} cigarettes`), ' less smog breathed in each week',
      co2 > 0.05 ? `, and ${fmt(co2, 1)} kg less CO₂ from your commutes` : '', '.'));
  /** @type {HTMLElement} */ (out.querySelector('.meter-fill')).style.width = `${Math.min(100, c.pct)}%`;
}

function renderPlan(plan) {
  const out = $('#plan-out');
  out.setAttribute('lang', plan.source === 'gemini' ? plan.lang || 'en' : 'en');
  mount(out,
    plan.headline && h('p', { class: 'plan-headline' }, plan.headline),
    plan.alerts?.length > 0 && h('div', { class: 'alerts', role: 'note' },
      plan.alerts.map((a) => h('p', { class: `alert ${a.level}` }, h('strong', {}, `${a.who}: `), a.text))),
    h('ol', { class: 'timeline' }, plan.schedule.map((s) => h('li', {},
      h('span', { class: 'time' }, s.time), h('div', {}, h('strong', {}, s.title), h('p', {}, s.detail))))),
    plan.perMember?.length > 0 && h('div', { class: 'per-member' },
      h('h3', {}, 'For each person'),
      h('ul', {}, plan.perMember.map((m) => h('li', {}, h('strong', {}, `${m.name}: `), m.advice)))),
    plan.impactStory && h('div', { class: 'impact-story' }, h('h3', {}, 'What changes if you act'), richText(plan.impactStory)),
    plan.source === 'offline' && h('p', { class: 'hint' }, 'This is SaansSaathi\'s built-in plan. Use "Personalise with Gemini" for advice written for each person, in your language.'),
    plan.source === 'gemini' && h('p', { class: 'hint' }, 'Written by Gemini from your numbers. Check medical advice with a doctor.'));
}

function renderStatic(plan) {
  mount($('#hacks'), plan.hacks.map((x) => h('li', {}, h('strong', {}, x.title), h('p', {}, x.text))));
  mount($('#community'), plan.community.map((x) => h('li', {}, h('strong', {}, x.title), h('p', {}, x.text))));
  mount($('#myths'), MYTHS.map((m) => [h('dt', {}, `“${m.myth}”`), h('dd', {}, m.fact)]));
}

/* ---------------- Gemini ---------------- */

function context() {
  const dose = householdDose(app.state.members, app.state.home, app.env);
  return buildContext({ place: placeLabel(app.state.place), env: app.env, state: app.state, dose, swaps: app.swaps });
}

function requireKey() {
  const key = loadApiKey();
  if (!key) {
    openSettings();
    return null;
  }
  return key;
}

async function onGeneratePlan() {
  if (!app.env || app.busy) return;
  const key = requireKey();
  if (!key) return;
  const status = $('#plan-status');
  const btn = /** @type {HTMLButtonElement} */ ($('#gen-plan'));
  app.busy = true;
  btn.disabled = true;
  status.textContent = 'Gemini is writing your family\'s plan…';
  try {
    const plan = await generatePlan({ apiKey: key, model: app.prefs.model || DEFAULT_MODEL, context: context(), lang: app.prefs.lang });
    const offline = currentOfflinePlan();
    app.aiPlan = { ...plan, alerts: offline.alerts, lang: app.prefs.lang };
    renderPlan(app.aiPlan);
    status.textContent = 'Plan ready.';
  } catch (e) {
    status.textContent = `${e.message} Showing the built-in plan instead.`;
  } finally {
    app.busy = false;
    btn.disabled = false;
  }
}

function addChat(role, text) {
  const log = $('#chat-log');
  const bubble = h('div', { class: `bubble ${role}`, lang: role === 'model' ? app.prefs.lang : undefined },
    h('span', { class: 'sr-only' }, role === 'user' ? 'You said: ' : 'SaansSaathi said: '),
    role === 'model' ? richText(text) : h('p', {}, text));
  log.append(bubble);
  bubble.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return bubble;
}

async function onAsk(question) {
  const q = question.trim();
  if (!q || !app.env || app.busy) return;
  const key = requireKey();
  if (!key) return;
  app.busy = true;
  addChat('user', q);
  const pending = h('div', { class: 'bubble model pending' }, 'Thinking…');
  $('#chat-log').append(pending);
  try {
    const answer = await ask({ apiKey: key, model: app.prefs.model || DEFAULT_MODEL, context: context(),
      lang: app.prefs.lang, history: app.chat, question: q });
    pending.remove();
    addChat('model', answer);
    app.chat.push({ role: 'user', text: q }, { role: 'model', text: answer });
  } catch (e) {
    pending.remove();
    addChat('model', `Error: ${e.message}`);
  } finally {
    app.busy = false;
  }
}

function renderSuggestions() {
  const first = app.state.members.find((m) => AGE_GROUPS[m.age]?.sensitive)?.name ?? app.state.members[0]?.name ?? 'my family';
  const qs = [
    `Is it safe for ${first} to go outside tomorrow?`,
    'Explain our biggest exposure source like I\'m 10.',
    'Plan a smog-safe Diwali or wedding evening for us.',
    'How do I get my housing society to stop garbage burning?',
  ];
  mount($('#suggestions'), qs.map((q) => {
    const b = h('button', { type: 'button', class: 'chip-btn' }, q);
    b.addEventListener('click', () => onAsk(q));
    return b;
  }));
}

/* ---------------- Settings ---------------- */

function openSettings() {
  const dlg = /** @type {HTMLDialogElement} */ ($('#settings'));
  /** @type {HTMLInputElement} */ ($('#api-key')).value = loadApiKey();
  /** @type {HTMLInputElement} */ ($('#model')).value = app.prefs.model;
  dlg.showModal();
}

function initSettings() {
  $('#open-settings').addEventListener('click', openSettings);
  const dlg = /** @type {HTMLDialogElement} */ ($('#settings'));
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    const key = /** @type {HTMLInputElement} */ ($('#api-key')).value;
    const remember = /** @type {HTMLInputElement} */ ($('#remember-key')).checked;
    const model = /** @type {HTMLInputElement} */ ($('#model')).value.trim();
    saveApiKey(key, remember);
    app.prefs.model = /^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(model) ? model : '';
    savePrefs(app.prefs);
    $('#plan-status').textContent = key.trim() ? 'Gemini key saved. AI features are on.' : 'Gemini key removed.';
  });

  const lang = /** @type {HTMLSelectElement} */ ($('#lang'));
  mount(lang, Object.entries(LANGUAGES).map(([k, v]) => h('option', { value: k, selected: k === app.prefs.lang }, v)));
  lang.addEventListener('change', () => { app.prefs.lang = lang.value; savePrefs(app.prefs); });
}

/* ---------------- Orchestration ---------------- */

function currentOfflinePlan() {
  return buildOfflinePlan(app.state, app.env, app.swaps);
}

function recompute() {
  if (!app.env) return;
  const dose = householdDose(app.state.members, app.state.home, app.env);
  app.swaps = rankSwaps(app.state, app.env);
  if (!app.selected.size) app.swaps.slice(0, 3).forEach((s) => app.selected.add(s.id));
  renderBudget(dose);
  renderSwaps();
  const offline = currentOfflinePlan();
  renderPlan(app.aiPlan ?? offline);
  renderStatic(offline);
  renderSuggestions();
}

const persist = debounce(() => saveState(app.state), 300);
const recomputeSoon = debounce(recompute, 120);

/**
 * Called after any household edit.
 * @param {boolean} [structural=true] whether numbers changed (vs. a rename)
 */
function changed(structural = true) {
  persist();
  if (structural) app.aiPlan = null; // the AI plan no longer matches the inputs
  recomputeSoon();
}

function init() {
  initSettings();
  initPlaceSearch();
  renderHome();
  renderMembers();
  $('#add-member').addEventListener('click', () => {
    if (app.state.members.length >= 10) return;
    app.state.members.push(newMember(`Person ${app.state.members.length + 1}`));
    renderMembers();
    changed();
    /** @type {HTMLInputElement} */ ($('#members').lastElementChild?.querySelector('input'))?.focus();
  });
  $('#demo-btn').addEventListener('click', () => {
    const demo = demoState();
    const placeChanged = demo.place.name !== app.state.place.name;
    app.state = demo;
    app.selected.clear();
    app.aiPlan = null;
    renderHome();
    renderMembers();
    persist();
    /** @type {HTMLInputElement} */ ($('#place-input')).value = placeLabel(demo.place);
    if (placeChanged) loadAir(); else recompute();
  });
  $('#gen-plan').addEventListener('click', onGeneratePlan);
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ ($('#chat-input'));
    onAsk(input.value);
    input.value = '';
  });
  loadAir();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
