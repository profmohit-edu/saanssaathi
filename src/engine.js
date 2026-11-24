/**
 * Offline, deterministic planner. Always available, so the app works with no
 * API key or network access to the model. It also serves as the grounding
 * facts passed to Gemini.
 * @module engine
 */
import { bandForPm25 } from './aqi.js';
import { AGE_GROUPS, infiltrationRatio } from './exposure.js';
import { formatRange, ventilationHours } from './windows.js';
import { communityActions } from './local.js';

/** Evidence-based indoor air hacks. `when` decides relevance. */
const HACKS = [
  { id: 'cr-box', title: 'DIY Corsi–Rosenthal cube',
    text: 'Tape four MERV-13 filters into a cube with a 20-inch box fan on top. It cleans a bedroom’s air several times an hour for about a third of what a purifier costs.',
    when: (h) => !h.purifier },
  { id: 'bedroom-first', title: 'Make the bedroom the clean room',
    text: 'You spend about a third of the day asleep. Put the purifier there, shut the door an hour before bed and keep the fan on low all night.',
    when: () => true },
  { id: 'wet-mop', title: 'Wet-mop, don’t sweep',
    text: 'Dry sweeping puts settled dust back in the air. A damp cloth or mop traps it instead.',
    when: () => true },
  { id: 'seal', title: 'Seal the gaps',
    text: 'Foam draught tape on window frames and a door snake cost under ₹300 and cut how much outdoor air leaks in.',
    when: (h) => h.windows !== 'closed' || !h.purifier },
  { id: 'exhaust', title: 'Exhaust on, every time you cook',
    text: 'Frying and tadka produce fine particles. Run the chimney or exhaust fan and keep the kitchen door shut.',
    when: () => true },
  { id: 'humidity', title: 'Watch the filter, not the plant',
    text: 'Indoor plants hardly change PM2.5. Spend the money on replacement filters, and change them when they turn grey.',
    when: () => true },
  { id: 'no-burn', title: 'No burning inside, even for “purifying”',
    text: 'Camphor, dhoop and havan samagri all release fine smoke. If it’s a ritual, do it briefly by an open window in a clean-air window.',
    when: (h) => (h.sources ?? []).some((s) => ['incense', 'coil'].includes(s)) },
];

/** Common winter-smog myths, each with the fact. */
export const MYTHS = [
  { myth: 'Morning walks are the healthiest.', fact: 'In winter smog, early mornings are often the dirtiest hours, because the air stays trapped near the ground until the sun warms it. Afternoons are usually cleaner.' },
  { myth: 'A surgical or cloth mask is enough.', fact: 'Fine particles leak around loose masks. Only a well-fitted N95/FFP2 gives meaningful protection.' },
  { myth: 'Plants will clean my room.', fact: 'You would need hundreds of plants to match one small purifier.' },
  { myth: 'Indoors is always safe.', fact: 'Without filtration, indoor PM2.5 is often 60–90% of the outdoor level, and higher when incense or solid fuel is burned.' },
];

/**
 * Health alerts for sensitive members.
 * @param {object[]} members
 * @param {number} pm25 current µg/m³
 */
export function healthAlerts(members, pm25) {
  const band = bandForPm25(pm25);
  const severeish = ['poor', 'very_poor', 'severe'].includes(band.key);
  const alerts = [];
  for (const m of members) {
    const age = AGE_GROUPS[m.age] ?? AGE_GROUPS.adult;
    const conds = m.conditions ?? [];
    if (conds.includes('asthma') && band.key !== 'good') {
      alerts.push({ who: m.name, level: severeish ? 'high' : 'medium',
        text: 'Keep the reliever inhaler on hand, follow the asthma action plan, and see a doctor if night-time cough or wheeze increases.' });
    }
    if (conds.includes('heart') && severeish) {
      alerts.push({ who: m.name, level: 'high',
        text: 'Fine particles strain the heart. Avoid exertion outdoors, and get chest pain or breathlessness checked right away.' });
    }
    if (conds.includes('pregnant') && severeish) {
      alerts.push({ who: m.name, level: 'high',
        text: 'During pregnancy, limit time outdoors on Poor or worse days and sleep in the filtered room.' });
    }
    if (age.sensitive && severeish && m.outdoorActivity === 'vigorous') {
      alerts.push({ who: m.name, level: 'medium',
        text: 'Children and seniors breathe more air for their body size. Move active play indoors today.' });
    }
  }
  return alerts;
}

/**
 * Builds an hour-by-hour plan for the next day.
 * @param {{members:object[], home:object}} state
 * @param {object} env from buildEnvironment
 * @param {ReturnType<import('./swaps.js').rankSwaps>} swaps ranked swaps
 */
export function buildOfflinePlan(state, env, swaps) {
  const band = bandForPm25(env.current);
  const best2 = env.bestFor(2);
  const indoorEst = env.dailyMean * infiltrationRatio(state.home);
  const vent = ventilationHours(env.hours, indoorEst);
  const items = [];

  if (env.peak) {
    items.push({ time: formatRange(env.peak.start, env.peak.end), title: 'Peak smog: windows shut, stay in',
      detail: `PM2.5 is forecast to average ${Math.round(env.peak.mean)} µg/m³ here. Keep doors and windows closed and the purifier on high, and push errands to later.` });
  }
  if (best2) {
    const outdoorPeople = state.members.filter((m) => m.outdoorHours > 0).map((m) => m.name);
    items.push({ time: formatRange(best2.start, best2.end), title: 'Cleanest window: go out now',
      detail: `Averages ${Math.round(best2.mean)} µg/m³. Use it for walks, play and errands${outdoorPeople.length ? ` (${outdoorPeople.join(', ')})` : ''}.` });
  }
  if (vent.length) {
    const first = vent[0].time;
    items.push({ time: formatRange(first, new Date(first.getTime() + 3600000)),
      title: 'Air out the home for 15 minutes',
      detail: 'Outdoor air is briefly cleaner than indoor air. Open opposite windows for a cross-breeze, then seal up again.' });
  } else {
    items.push({ time: 'All day', title: 'Don’t open the windows to air out today',
      detail: 'Outdoor air stays dirtier than indoor air all day. Use the kitchen exhaust for fresh air instead.' });
  }
  const commuters = state.members.filter((m) => m.commuteMode !== 'none' && m.commuteHours > 0);
  if (commuters.length) {
    items.push({ time: 'Commute', title: 'Commute smart',
      detail: `${commuters.map((m) => m.name).join(', ')}: wear an N95 outside cabins, keep car windows up with AC on recirculate, and avoid waiting at busy junctions. Rush-hour air averages ${Math.round(env.commuteMean)} µg/m³.` });
  }
  items.push({ time: 'Bedtime', title: 'Make the bedroom the clean room',
    detail: 'Shut the bedroom door an hour before sleep and run the filter on low all night.' });

  items.sort((a, b) => order(a.time) - order(b.time));

  const top = swaps.slice(0, 3);
  return {
    source: 'offline',
    headline: `${band.label} air (${Math.round(env.current)} µg/m³ now). ${band.advice}`,
    schedule: items,
    topSwaps: top.map((s) => s.title),
    alerts: healthAlerts(state.members, env.current),
    hacks: HACKS.filter((h) => h.when(state.home)).map(({ title, text }) => ({ title, text })),
    myths: MYTHS,
    community: communityActions(state.place),
  };
}

function order(timeLabel) {
  if (timeLabel === 'All day') return -1;
  if (timeLabel === 'Commute') return 50;
  if (timeLabel === 'Bedtime') return 99;
  const m = /^(\d{1,2})\s*(am|pm)/i.exec(timeLabel);
  if (!m) return 60;
  let h = Number(m[1]) % 12;
  if (m[2].toLowerCase() === 'pm') h += 12;
  return h;
}
