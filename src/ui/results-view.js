/**
 * Results: Breath Budget, swap simulator, day plan, and static guidance.
 * All functions are render-only; they read state and never mutate it,
 * except the swap checkboxes, which update the selection set.
 * @module ui/results-view
 */
import { h, mount, byId, richText } from '../dom.js';
import { UG_PER_CIGARETTE, lookup } from '../exposure.js';
import { combine } from '../swaps.js';
import { MYTHS } from '../engine.js';
import { fmt } from '../format.js';
import { DAYS_PER_WEEK, MIN_CO2_DELTA_KG, MIN_DOSE_DELTA_UG } from '../config.js';

/** Labels for the micro-environments in the dose breakdown. */
export const PART_LABELS = Object.freeze({
  sleep: 'Sleep',
  indoors: 'Indoors',
  commute: 'Commute',
  outdoors: 'Outdoors',
});

/**
 * Stacked bar of one member's dose by micro-environment.
 * @param {{name: string, parts: Record<string, number>}} d
 * @param {number} max largest member total, for scaling
 */
function doseBar(d, max) {
  const label = Object.entries(d.parts)
    .map(([k, v]) => `${lookup(PART_LABELS, k)} ${fmt(v)} µg`)
    .join(', ');
  return h(
    'div',
    { class: 'stack', role: 'img', 'aria-label': `${d.name}: ${label}` },
    Object.entries(d.parts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => {
        const seg = h('span', {
          class: `seg seg-${k}`,
          title: `${lookup(PART_LABELS, k)}: ${fmt(v)} µg`,
        });
        seg.style.width = `${(v / max) * 100}%`;
        return seg;
      }),
  );
}

/**
 * Renders the household Breath Budget.
 * @param {ReturnType<typeof import('../exposure.js').householdDose>} dose
 */
export function renderBudget(dose) {
  const max = Math.max(...dose.perMember.map((d) => d.total), 1);
  mount(
    byId('budget-out'),
    h(
      'p',
      { class: 'budget-headline' },
      'Together your household inhales about ',
      h('strong', {}, `${fmt(dose.total)} µg`),
      ' of PM2.5 a day, the same as smoking ',
      h('strong', {}, `${fmt(dose.cigarettes, 1)} cigarettes`),
      '.',
    ),
    h(
      'ul',
      { class: 'budget-list' },
      dose.perMember.map((d) =>
        h(
          'li',
          { class: 'budget-row' },
          h(
            'div',
            { class: 'budget-meta' },
            h('span', { class: 'who' }, d.name),
            h('span', { class: 'num' }, `${fmt(d.total)} µg`),
            h('span', { class: 'cig', title: 'Cigarette equivalent' }, `${fmt(d.cigarettes, 1)} cig. eq.`),
            h('span', { class: `who-x ${d.whoMultiple > 1 ? 'over' : 'ok'}` }, `${fmt(d.whoMultiple, 1)}× WHO`),
          ),
          doseBar(d, max),
        ),
      ),
    ),
    h(
      'ul',
      { class: 'legend', 'aria-hidden': 'true' },
      Object.entries(PART_LABELS).map(([k, l]) => h('li', {}, h('span', { class: `dot seg-${k}` }), l)),
    ),
  );
}

/**
 * One row of the swap list.
 * @param {import('../types.js').AppState['swaps'][number]} s
 * @param {number} rank 1-based
 * @param {boolean} checked
 * @param {(checked: boolean) => void} onToggle
 */
function swapItem(s, rank, checked, onToggle) {
  const cb = h('input', { type: 'checkbox', id: `swap-${s.id}`, checked });
  cb.addEventListener('change', () => onToggle(cb.checked));
  const top = s.perMember
    .filter((p) => p.pct >= 1)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  const showsDose = s.deltaUg > MIN_DOSE_DELTA_UG;
  return h(
    'li',
    { class: `swap cat-${s.category}` },
    h('div', { class: 'swap-check' }, cb),
    h(
      'div',
      { class: 'swap-body' },
      h('label', { for: `swap-${s.id}`, class: 'swap-title' }, h('span', { class: 'rank' }, `#${rank}`), s.title),
      h(
        'p',
        { class: 'swap-impact' },
        showsDose && h('strong', {}, `−${fmt(s.pct)}% family dose`),
        showsDose && ` · ≈ ${fmt(s.cigarettesPerWeek, 1)} cigarettes avoided / week`,
        s.co2KgPerWeek > MIN_CO2_DELTA_KG && ` · ${fmt(s.co2KgPerWeek, 1)} kg CO₂ less / week`,
      ),
      top.length > 0 && h('p', { class: 'swap-who' }, top.map((p) => `${p.name} −${fmt(p.pct)}%`).join(' · ')),
      h('p', { class: 'swap-why' }, s.why),
      h('p', { class: 'swap-cost' }, h('span', { class: 'tag' }, s.category), ' ', s.cost),
    ),
  );
}

/**
 * Renders the ranked swap list and the combined total.
 * @param {import('../types.js').AppState} app
 */
export function renderSwaps(app) {
  const list = byId('swap-list');
  if (!app.swaps.length) {
    mount(list, h('li', { class: 'empty' }, 'Your household is already doing everything SaansSaathi would suggest.'));
  } else {
    mount(
      list,
      app.swaps.map((s, i) =>
        swapItem(s, i + 1, app.selected.has(s.id), (on) => {
          if (on) {
            app.selected.add(s.id);
          } else {
            app.selected.delete(s.id);
          }
          renderSwapTotal(app);
        }),
      ),
    );
  }
  renderSwapTotal(app);
}

/**
 * Renders the combined effect of the selected swaps.
 * @param {import('../types.js').AppState} app
 */
export function renderSwapTotal(app) {
  const out = byId('swap-total');
  if (!app.env) {
    return;
  }
  const ids = [...app.selected].filter((id) => app.swaps.some((s) => s.id === id));
  if (!ids.length) {
    mount(out, h('p', {}, 'Tick one or more swaps to see the combined effect.'));
    return;
  }
  const c = combine(app.state, app.env, ids);
  const weeklyCigarettes = ((c.before.total - c.after.total) / UG_PER_CIGARETTE) * DAYS_PER_WEEK;
  const co2 = app.swaps.filter((s) => ids.includes(s.id)).reduce((sum, s) => sum + s.co2KgPerWeek, 0);
  const fill = h('span', { class: 'meter-fill' });
  fill.style.width = `${Math.min(100, c.pct)}%`;
  mount(
    out,
    h('div', { class: 'meter', role: 'img', 'aria-label': `Dose falls by ${fmt(c.pct)} percent` }, fill),
    h(
      'p',
      { class: 'swap-total-text' },
      'With these ',
      h('strong', {}, String(ids.length)),
      " swaps your family's daily dose falls from ",
      h('strong', {}, `${fmt(c.before.total)} µg`),
      ' to ',
      h('strong', {}, `${fmt(c.after.total)} µg`),
      ` (−${fmt(c.pct)}%). That's about `,
      h('strong', {}, `${fmt(weeklyCigarettes, 1)} cigarettes`),
      ' less smog breathed in each week',
      co2 > MIN_CO2_DELTA_KG ? `, and ${fmt(co2, 1)} kg less CO₂ from your commutes` : '',
      '.',
    ),
  );
}

/**
 * Health alerts block, or nothing.
 * @param {import('../types.js').Plan['alerts']} alerts
 */
function alertsBlock(alerts = []) {
  if (!alerts.length) {
    return null;
  }
  return h(
    'div',
    { class: 'alerts', role: 'note' },
    alerts.map((a) => h('p', { class: `alert ${a.level}` }, h('strong', {}, `${a.who}: `), a.text)),
  );
}

/**
 * Per-member advice block, or nothing.
 * @param {import('../types.js').Plan['perMember']} perMember
 */
function perMemberBlock(perMember = []) {
  if (!perMember.length) {
    return null;
  }
  return h(
    'div',
    { class: 'per-member' },
    h('h3', {}, 'For each person'),
    h(
      'ul',
      {},
      perMember.map((m) => h('li', {}, h('strong', {}, `${m.name}: `), m.advice)),
    ),
  );
}

/**
 * Timeline of schedule items.
 * @param {import('../types.js').Plan['schedule']} schedule
 */
function timeline(schedule) {
  return h(
    'ol',
    { class: 'timeline' },
    schedule.map((s) =>
      h('li', {}, h('span', { class: 'time' }, s.time), h('div', {}, h('strong', {}, s.title), h('p', {}, s.detail))),
    ),
  );
}

const PLAN_NOTES = Object.freeze({
  gemini: 'Written by Gemini from your numbers. Check medical advice with a doctor.',
  'gemini-nano':
    'Written by Gemini Nano on this device from your numbers; nothing left your browser. Check medical advice with a doctor.',
  offline:
    'This is SaansSaathi\'s built-in plan. Use "Personalise with Gemini" for advice written for each person, in your language.',
});

/**
 * Renders a day plan (offline or Gemini).
 * @param {import('../types.js').Plan} plan
 */
export function renderPlan(plan) {
  const out = byId('plan-out');
  out.setAttribute('lang', plan.source === 'offline' ? 'en' : plan.lang || 'en');
  mount(
    out,
    plan.headline && h('p', { class: 'plan-headline' }, plan.headline),
    alertsBlock(plan.alerts),
    timeline(plan.schedule),
    perMemberBlock(plan.perMember),
    plan.impactStory &&
      h('div', { class: 'impact-story' }, h('h3', {}, 'What changes if you act'), richText(plan.impactStory)),
    h('p', { class: 'hint' }, PLAN_NOTES[plan.source]),
  );
}

/**
 * Renders a titled list of tips.
 * @param {string} id
 * @param {Array<{title: string, text: string}>} items
 */
function tipList(id, items) {
  mount(
    byId(id),
    items.map((x) => h('li', {}, h('strong', {}, x.title), h('p', {}, x.text))),
  );
}

/**
 * Renders the indoor hacks, community actions and myths.
 * @param {{hacks: Array<{title: string, text: string}>, community: Array<{title: string, text: string}>}} plan
 */
export function renderGuidance(plan) {
  tipList('hacks', plan.hacks);
  tipList('community', plan.community);
  mount(
    byId('myths'),
    MYTHS.map((m) => [h('dt', {}, `“${m.myth}”`), h('dd', {}, m.fact)]),
  );
}
