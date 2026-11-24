/**
 * Household editor: home settings and one collapsible card per member.
 * Edits mutate the shared state and notify the controller via `actions.changed`.
 * @module ui/household-view
 */
import { h, mount, byId } from '../dom.js';
import { AGE_GROUPS, COMMUTE_MODES, MASKS, OUTDOOR_ACTIVITY, INDOOR_SOURCES } from '../exposure.js';
import { OUTDOOR_SLOTS } from '../environment.js';
import { CONDITIONS, memberSummary } from '../format.js';
import { MAX_COMMUTE_HOURS, MAX_NAME_LENGTH, MAX_OUTDOOR_HOURS } from '../config.js';

/**
 * @typedef {object} FieldSpec
 * @property {string} id element id
 * @property {string} label visible label
 */

/**
 * Labelled <select> bound to an options map.
 * @param {FieldSpec & {value: string, options: Record<string, string | {label: string}>, onChange: (value: string) => void}} spec
 */
export function selectField({ id, label, value, options, onChange }) {
  const choices = Object.entries(options).map(([k, v]) =>
    h('option', { value: k, selected: k === value }, typeof v === 'string' ? v : v.label),
  );
  const sel = h('select', { id }, choices);
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, h('label', { for: id }, label), sel);
}

/**
 * Labelled numeric input that only reports valid values.
 * @param {FieldSpec & {value: number, onChange: (value: number) => void, min?: number, max?: number, step?: number}} spec
 */
export function numberField({ id, label, value, onChange, min = 0, max = MAX_OUTDOOR_HOURS, step = 0.5 }) {
  const inp = h('input', { id, type: 'number', inputmode: 'decimal', min, max, step, value });
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    const valid = inp.value !== '' && Number.isFinite(n) && n >= min && n <= max;
    if (valid) {
      inp.removeAttribute('aria-invalid');
      onChange(n);
    } else {
      inp.setAttribute('aria-invalid', 'true');
    }
  });
  return h('div', { class: 'field' }, h('label', { for: id }, label), inp);
}

/**
 * Group of checkbox "chips" bound to a list of selected keys.
 * @param {{idPrefix: string, legend: string, options: Record<string, string>, selected: string[], onChange: (next: string[]) => void}} spec
 */
export function chipGroup({ idPrefix, legend, options, selected, onChange }) {
  let current = [...selected];
  return h(
    'fieldset',
    { class: 'chips' },
    h('legend', {}, legend),
    Object.entries(options).map(([key, label]) => {
      const id = `${idPrefix}-${key}`;
      const cb = h('input', { type: 'checkbox', id, checked: current.includes(key) });
      cb.addEventListener('change', () => {
        current = cb.checked ? [...new Set([...current, key])] : current.filter((k) => k !== key);
        onChange(current);
      });
      return h('label', { class: 'chip', for: id }, cb, label);
    }),
  );
}

/**
 * Renders the home settings block.
 * @param {import('../types.js').AppContext} ctx
 */
export function renderHome({ app, actions }) {
  const home = app.state.home;
  const purifier = h('input', { type: 'checkbox', id: 'home-purifier', checked: home.purifier });
  purifier.addEventListener('change', () => {
    home.purifier = purifier.checked;
    actions.changed();
  });
  const sourceLabels = Object.fromEntries(Object.entries(INDOOR_SOURCES).map(([k, s]) => [k, s.label]));

  mount(
    byId('home-grid'),
    selectField({
      id: 'home-windows',
      label: 'Windows during the day',
      value: home.windows,
      options: { open: 'Mostly open', closed: 'Mostly closed' },
      onChange: (v) => {
        home.windows = v === 'closed' ? 'closed' : 'open';
        actions.changed();
      },
    }),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'check', for: 'home-purifier' }, purifier, 'Air purifier or DIY filter'),
    ),
    chipGroup({
      idPrefix: 'src',
      legend: 'Things burned or used at home',
      options: sourceLabels,
      selected: home.sources,
      onChange: (next) => {
        home.sources = next;
        actions.changed();
      },
    }),
  );
}

/**
 * Name input that keeps the card summary in sync.
 * @param {import('../types.js').Member} m
 * @param {number} idx
 * @param {HTMLElement} summaryName
 * @param {import('../types.js').AppActions} actions
 */
function nameField(m, idx, summaryName, actions) {
  const id = `${m.id}-name`;
  const input = h('input', { id, type: 'text', maxlength: MAX_NAME_LENGTH, value: m.name, autocomplete: 'off' });
  input.addEventListener('input', () => {
    m.name = input.value.slice(0, MAX_NAME_LENGTH) || `Person ${idx + 1}`;
    summaryName.textContent = m.name;
    actions.changed(false);
  });
  return h('div', { class: 'field grow' }, h('label', { for: id }, 'Name'), input);
}

/**
 * "Remove" button, shown only when there is more than one member.
 * @param {import('../types.js').Member} m
 * @param {import('../types.js').AppContext} ctx
 */
function removeButton(m, { app, actions }) {
  const btn = h('button', { type: 'button', class: 'btn ghost small', 'aria-label': `Remove ${m.name}` }, 'Remove');
  btn.addEventListener('click', () => {
    app.state.members = app.state.members.filter((x) => x.id !== m.id);
    actions.renderMembers();
    actions.changed();
    byId('add-member').focus();
  });
  return btn;
}

/**
 * The routine fields for one member.
 * @param {import('../types.js').Member} m
 * @param {import('../types.js').AppActions} actions
 */
function routineFields(m, actions) {
  /** @param {string} suffix */
  const id = (suffix) => `${m.id}-${suffix}`;
  /** @param {keyof import('../types.js').Member} key */
  const set = (key) => (/** @type {unknown} */ value) => {
    Object.assign(m, { [key]: value });
    actions.changed();
  };
  /** @param {keyof import('../types.js').Member} key @param {string} label @param {Record<string, any>} options @param {string} suffix */
  const select = (key, label, options, suffix) =>
    selectField({ id: id(suffix), label, value: String(m[key]), options, onChange: set(key) });
  return [
    select('age', 'Age group', AGE_GROUPS, 'age'),
    select('commuteMode', 'Commute', COMMUTE_MODES, 'commute'),
    numberField({
      id: id('ch'),
      label: 'Commute hours / day',
      value: m.commuteHours,
      onChange: set('commuteHours'),
      max: MAX_COMMUTE_HOURS,
    }),
    numberField({ id: id('oh'), label: 'Outdoor hours / day', value: m.outdoorHours, onChange: set('outdoorHours') }),
    select('outdoorTime', 'Usually outside', OUTDOOR_SLOTS, 'ot'),
    select('outdoorActivity', 'Outdoor activity', OUTDOOR_ACTIVITY, 'oa'),
    select('mask', 'Mask', MASKS, 'mask'),
  ];
}

/**
 * Builds one member card.
 * @param {import('../types.js').Member} m
 * @param {number} idx
 * @param {import('../types.js').AppContext} ctx
 */
function memberCard(m, idx, ctx) {
  const { app, actions } = ctx;
  const summaryName = h('strong', {}, m.name);
  const summaryMeta = h('span', { class: 'summary-meta' }, memberSummary(m));
  const card = h(
    'details',
    { class: 'member', open: idx === 0 || app.state.members.length === 1 },
    h('summary', {}, summaryName, summaryMeta),
    h(
      'div',
      { class: 'member-head' },
      nameField(m, idx, summaryName, actions),
      app.state.members.length > 1 && removeButton(m, ctx),
    ),
    h('div', { class: 'member-grid' }, routineFields(m, actions)),
    chipGroup({
      idPrefix: `${m.id}-c`,
      legend: 'Health',
      options: CONDITIONS,
      selected: m.conditions,
      onChange: (next) => {
        m.conditions = next;
        actions.changed();
      },
    }),
  );
  card.addEventListener('change', () => {
    summaryMeta.textContent = memberSummary(m);
  });
  return card;
}

/**
 * Renders all member cards.
 * @param {import('../types.js').AppContext} ctx
 */
export function renderMembers(ctx) {
  mount(
    byId('members'),
    ctx.app.state.members.map((m, i) => memberCard(m, i, ctx)),
  );
}
