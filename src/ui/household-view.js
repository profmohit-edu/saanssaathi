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
 * Labelled <select> bound to an options map.
 * @param {string} label
 * @param {string} value current key
 * @param {Record<string, string | {label: string}>} options
 * @param {(value: string) => void} onChange
 * @param {string} id
 */
export function selectField(label, value, options, onChange, id) {
  const sel = /** @type {HTMLSelectElement} */ (
    h(
      'select',
      { id },
      Object.entries(options).map(([k, v]) =>
        h('option', { value: k, selected: k === value }, typeof v === 'string' ? v : v.label),
      ),
    )
  );
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, h('label', { for: id }, label), sel);
}

/**
 * Labelled numeric input that only reports valid values.
 * @param {string} label
 * @param {number} value
 * @param {(value: number) => void} onChange
 * @param {string} id
 * @param {{min?: number, max?: number, step?: number}} [limits]
 */
export function numberField(label, value, onChange, id, { min = 0, max = MAX_OUTDOOR_HOURS, step = 0.5 } = {}) {
  const inp = /** @type {HTMLInputElement} */ (
    h('input', { id, type: 'number', inputmode: 'decimal', min, max, step, value })
  );
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
 * @param {string} legend
 * @param {Record<string, string>} options key → label
 * @param {string[]} selected
 * @param {(next: string[]) => void} onChange
 * @param {string} idPrefix
 */
export function chipGroup(legend, options, selected, onChange, idPrefix) {
  let current = [...selected];
  return h(
    'fieldset',
    { class: 'chips' },
    h('legend', {}, legend),
    Object.entries(options).map(([key, label]) => {
      const id = `${idPrefix}-${key}`;
      const cb = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id, checked: current.includes(key) }));
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
  const purifier = /** @type {HTMLInputElement} */ (
    h('input', { type: 'checkbox', id: 'home-purifier', checked: home.purifier })
  );
  purifier.addEventListener('change', () => {
    home.purifier = purifier.checked;
    actions.changed();
  });
  const sourceLabels = Object.fromEntries(Object.entries(INDOOR_SOURCES).map(([k, s]) => [k, s.label]));

  mount(
    byId('home-grid'),
    selectField(
      'Windows during the day',
      home.windows,
      { open: 'Mostly open', closed: 'Mostly closed' },
      (v) => {
        home.windows = v === 'closed' ? 'closed' : 'open';
        actions.changed();
      },
      'home-windows',
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'check', for: 'home-purifier' }, purifier, 'Air purifier or DIY filter'),
    ),
    chipGroup(
      'Things burned or used at home',
      sourceLabels,
      home.sources,
      (next) => {
        home.sources = next;
        actions.changed();
      },
      'src',
    ),
  );
}

/**
 * Builds one member card.
 * @param {import('../types.js').Member} m
 * @param {number} idx
 * @param {import('../types.js').AppContext} ctx
 */
function memberCard(m, idx, { app, actions }) {
  const id = (/** @type {string} */ s) => `${m.id}-${s}`;
  /** Updates a field and notifies the controller. */
  const set = (/** @type {keyof import('../types.js').Member} */ key) => (/** @type {any} */ v) => {
    /** @type {any} */ (m)[key] = v;
    actions.changed();
  };

  const summaryName = h('strong', {}, m.name);
  const summaryMeta = h('span', { class: 'summary-meta' }, memberSummary(m));
  const nameInput = /** @type {HTMLInputElement} */ (
    h('input', { id: id('name'), type: 'text', maxlength: MAX_NAME_LENGTH, value: m.name, autocomplete: 'off' })
  );
  nameInput.addEventListener('input', () => {
    m.name = nameInput.value.slice(0, MAX_NAME_LENGTH) || `Person ${idx + 1}`;
    summaryName.textContent = m.name;
    actions.changed(false);
  });

  const remove = h('button', { type: 'button', class: 'btn ghost small', 'aria-label': `Remove ${m.name}` }, 'Remove');
  remove.addEventListener('click', () => {
    app.state.members = app.state.members.filter((x) => x.id !== m.id);
    actions.renderMembers();
    actions.changed();
    byId('add-member').focus();
  });

  const card = h(
    'details',
    { class: 'member', open: idx === 0 || app.state.members.length === 1 },
    h('summary', {}, summaryName, summaryMeta),
    h(
      'div',
      { class: 'member-head' },
      h('div', { class: 'field grow' }, h('label', { for: id('name') }, 'Name'), nameInput),
      app.state.members.length > 1 && remove,
    ),
    h(
      'div',
      { class: 'member-grid' },
      selectField('Age group', m.age, AGE_GROUPS, set('age'), id('age')),
      selectField('Commute', m.commuteMode, COMMUTE_MODES, set('commuteMode'), id('commute')),
      numberField('Commute hours / day', m.commuteHours, set('commuteHours'), id('ch'), { max: MAX_COMMUTE_HOURS }),
      numberField('Outdoor hours / day', m.outdoorHours, set('outdoorHours'), id('oh')),
      selectField('Usually outside', m.outdoorTime, OUTDOOR_SLOTS, set('outdoorTime'), id('ot')),
      selectField('Outdoor activity', m.outdoorActivity, OUTDOOR_ACTIVITY, set('outdoorActivity'), id('oa')),
      selectField('Mask', m.mask, MASKS, set('mask'), id('mask')),
    ),
    chipGroup('Health', CONDITIONS, m.conditions, set('conditions'), id('c')),
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
